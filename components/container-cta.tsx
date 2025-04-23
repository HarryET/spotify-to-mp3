import Link from 'next/link';

export default function ContainerCta() {
  return (
    <div className="max-w-4xl mx-auto">
      <Link href="https://container.inc/?utm_source=spotify-converter" passHref legacyBehavior>
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="block py-4 px-6 bg-[#0078D4] hover:bg-[#005ea6] rounded-lg transition duration-150 ease-in-out shadow-md"
        >
          <div className="flex flex-row justify-center space-x-3 items-center text-center">
            <p className="text-base font-medium text-blue-100">
              Hosted on
            </p>
            <img 
              src="/icon-navbar.svg" 
              className="w-6 h-6" 
              alt="Container Inc. Logo" 
            />
            <h3 className="text-xl sm:text-2xl font-bold tracking-wider text-white">
              Container Inc.
            </h3>
          </div>
        </a>
      </Link>
    </div>
  );
}