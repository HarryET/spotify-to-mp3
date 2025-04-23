import SpotifyConverter from "@/components/spotify-converter"
import DownloadGuide from "@/components/download-guide"
import ContainerCta from "@/components/container-cta"

export default function Home() {
  return (
    <main className="space-y-12">
      <div className="max-w-4xl mx-auto bg-white p-6 md:p-8 rounded-lg shadow-md">
        <header className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-[#0078D4] mb-4">
            Spotify to MP3 Converter
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Convert your favorite Spotify playlists and tracks to MP3 files.
          </p>
        </header>

        <SpotifyConverter />
      </div>

      <ContainerCta />

      <div className="max-w-4xl mx-auto bg-white p-6 md:p-8 rounded-lg shadow-md">
        <DownloadGuide />
      </div>
    </main>
  )
}
