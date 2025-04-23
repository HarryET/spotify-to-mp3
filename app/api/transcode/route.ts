import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getServerRuntimeConfig } from '@/lib/config'
import { throttle } from '@/lib/utils'
import SYTDL from "s-ytdl"

// Track ongoing requests to prevent overloading the server
let ongoingRequests = 0
const MAX_CONCURRENT = 5 // Maximum concurrent transcoding operations

// Get yt-dlp path from environment or use default
const YT_DLP_PATH = process.env.YT_DLP_PATH || '/usr/local/bin/yt-dlp' // Ensure this matches Dockerfile

// Configure cache for responses
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Helper to check if we're on Vercel
const isVercelProd = process.env.VERCEL_ENV === 'production'
const isVercelEnvironment = !!process.env.VERCEL

// Helper function for the yt-dlp fallback
async function downloadWithYtDlp(videoId: string, requestId: string): Promise<DownloadResult | null> {
  console.log(`[API:transcode][${requestId}] Attempting final fallback using yt-dlp CLI...`)
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`
  const args = [
    '--format', 'bestaudio', // Get the best audio format
    '--output', '-',         // Pipe output to stdout
    youtubeUrl
  ]

  return new Promise((resolve, reject) => {
    console.log(`[API:transcode][${requestId}] Spawning yt-dlp: ${YT_DLP_PATH} ${args.join(' ')}`)
    const ytDlpProcess = spawn(YT_DLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const chunks: Buffer[] = []
    let errorOutput = ''

    ytDlpProcess.stdout.on('data', (chunk) => {
      chunks.push(chunk)
    })

    ytDlpProcess.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString()
    })

    ytDlpProcess.on('close', (code) => {
      if (code === 0) {
        if (chunks.length === 0) {
          console.error(`[API:transcode][${requestId}] yt-dlp exited successfully but produced no output.`)
          return reject(new Error('yt-dlp produced no output'))
        }
        const buffer = Buffer.concat(chunks)
        console.log(`[API:transcode][${requestId}] yt-dlp succeeded, received ${buffer.length} bytes.`)
        // yt-dlp default best audio is often opus/webm, but browsers handle mpeg better
        // We could add ffprobe or similar to detect, but 'audio/mpeg' is a safe bet
        resolve({
          buffer,
          size: buffer.length,
          mimeType: 'audio/mpeg'
        })
      } else {
        console.error(`[API:transcode][${requestId}] yt-dlp process exited with code ${code}. Error: ${errorOutput}`)
        reject(new Error(`yt-dlp failed with code ${code}: ${errorOutput.trim() || 'Unknown error'}`))
      }
    })

    ytDlpProcess.on('error', (err) => {
      console.error(`[API:transcode][${requestId}] Failed to spawn yt-dlp process: ${err.message}`)
      reject(new Error(`Failed to start yt-dlp: ${err.message}`))
    })
  })
}

interface DownloadResult {
  buffer: Buffer;
  size: number;
  mimeType: string;
}

// Handle transcoding requests with optimized resource usage
export async function GET(req: NextRequest) {
  const requestId = Date.now().toString()
  console.log(`[API:transcode][${requestId}] New request received at ${new Date().toISOString()}`)
  
  try {
    const { searchParams } = new URL(req.url)
    const videoId = searchParams.get('videoId')

    console.log(`[API:transcode][${requestId}] Processing videoId: ${videoId}`)
    console.log(`[API:transcode][${requestId}] Environment: Vercel=${isVercelEnvironment}, Prod=${isVercelProd}`)

    if (!videoId) {
      console.error(`[API:transcode][${requestId}] Error: Missing videoId parameter`)
      return NextResponse.json(
        { success: false, message: "Missing 'videoId' parameter" },
        { status: 400 }
      )
    }

    // Check if we're at capacity
    if (ongoingRequests >= MAX_CONCURRENT) {
      console.log(`[API:transcode][${requestId}] At capacity: ${ongoingRequests}/${MAX_CONCURRENT}`)
      return NextResponse.json(
        { 
          success: false, 
          message: "Server is at capacity. Please try again later."
        },
        { 
          status: 503,
          headers: {
            'Retry-After': '10'
          }
        }
      )
    }

    // Increment counter
    ongoingRequests++
    console.log(`[API:transcode][${requestId}] Incremented request counter to ${ongoingRequests}`)
    
    let audioData: DownloadResult | null = null
    const errors: string[] = []

    try {
      // 1. Try primary transcode (likely youtubei.js via @/lib/transcoder)
      try {
        console.log(`[API:transcode][${requestId}] Attempting primary transcode method...`)
        const { transcodeYouTubeVideo } = await import('@/lib/transcoder')
        const config = getServerRuntimeConfig()
        const throttledTranscode = throttle(transcodeYouTubeVideo, config.concurrentRequests || 2)
        audioData = await throttledTranscode(videoId)
        console.log(`[API:transcode][${requestId}] Primary transcode method succeeded`)
      } catch (primaryError: any) {
        console.error(`[API:transcode][${requestId}] Primary transcode failed:`, primaryError.message)
        errors.push(`Primary failed: ${primaryError.message}`)
        
        // 2. Try direct downloader (likely youtubei.js via @/lib/direct-downloader)
        try {
          console.log(`[API:transcode][${requestId}] Attempting direct downloader method...`)
          const { downloadWithFallback } = await import('@/lib/direct-downloader')
          audioData = await downloadWithFallback(videoId)
          console.log(`[API:transcode][${requestId}] Direct downloader method succeeded`)
        } catch (directError: any) {
          console.error(`[API:transcode][${requestId}] Direct downloader failed:`, directError.message)
          errors.push(`Direct downloader failed: ${directError.message}`)

          // 3. Try s-ytdl
          try {
            console.log(`[API:transcode][${requestId}] Attempting fallback s-ytdl method...`)
            const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`
            const tempDir = path.join(os.tmpdir(), "fallback-transcode")
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true })
            }
            const audioBuffer = await SYTDL.dl(youtubeUrl, "4", "audio")
            console.log(`[API:transcode][${requestId}] s-ytdl download complete, size: ${audioBuffer.length}`)
            audioData = {
              buffer: audioBuffer,
              size: audioBuffer.length,
              mimeType: 'audio/mpeg' // Assume MPEG
            }
            console.log(`[API:transcode][${requestId}] s-ytdl method succeeded`)
          } catch (sytdlError: any) {
            console.error(`[API:transcode][${requestId}] s-ytdl failed:`, sytdlError.message)
            errors.push(`s-ytdl failed: ${sytdlError.message}`)
            
            // 4. FINAL FALLBACK: Try yt-dlp CLI
            try {
              audioData = await downloadWithYtDlp(videoId, requestId)
              console.log(`[API:transcode][${requestId}] yt-dlp CLI method succeeded`)
            } catch (ytDlpError: any) {
               console.error(`[API:transcode][${requestId}] yt-dlp CLI failed:`, ytDlpError.message)
               errors.push(`yt-dlp CLI failed: ${ytDlpError.message}`)
               // If all methods failed, throw a consolidated error
               throw new Error(`All download methods failed: ${errors.join('; ')}`)
            }
          } 
        }
      }
      
      if (!audioData || !audioData.buffer || audioData.buffer.length === 0) {
        // If audioData is somehow null/empty after all attempts, throw error
        console.error(`[API:transcode][${requestId}] Failed to transcode video - no audio data produced after all fallbacks. Errors: ${errors.join('; ')}`)
        throw new Error(`Failed to transcode video - no audio data produced. Errors: ${errors.join('; ')}`)
      }
      
      console.log(`[API:transcode][${requestId}] Returning ${audioData.buffer.length} bytes with Content-Type: ${audioData.mimeType}`)
      
      // Return audio data as MP3
      return new NextResponse(audioData.buffer, {
        headers: {
          'Content-Type': audioData.mimeType,
          'Content-Length': audioData.buffer.length.toString(),
          'Content-Disposition': `attachment; filename="${videoId}.mp3"`,
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        },
      })
    } finally {
      // Always decrement the counter
      ongoingRequests--
      console.log(`[API:transcode][${requestId}] Decremented request counter to ${ongoingRequests}`)
    }
  } catch (error) {
    // Decrement counter if an error occurred before the finally block was reached
    // (e.g., during initial parameter validation)
    if (ongoingRequests > 0) { // Check to prevent double decrement
      ongoingRequests--
      console.log(`[API:transcode][${requestId}] Decremented request counter in catch block to ${ongoingRequests}`)
    }
    
    console.error(`[API:transcode][${requestId}] Unhandled error in GET handler:`, error)
    
    // Ensure we return proper JSON to avoid HTML responses
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString(),
        errorType: error instanceof Error ? error.name : 'Unknown'
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}