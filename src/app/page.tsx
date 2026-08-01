import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-[var(--awb-color3)] font-sans">
      <main className="flex flex-1 w-full max-w-[1200px] flex-col items-center justify-center py-[60px] px-[30px] bg-[var(--awb-color1)] shadow-sm rounded-lg my-8">
        <div className="flex flex-col items-center gap-6 text-center max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--awb-color2)] border border-[var(--awb-color3)] text-xs font-semibold text-[var(--awb-color8)] uppercase tracking-wider">
            StyleFlo AI Chatbot Platform
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-[var(--awb-color8)]">
            Seamless AI Chatbot & Scheduling Integration
          </h1>
          <p className="text-lg leading-relaxed text-[var(--awb-color7)]">
            Welcome to StyleFlo AI. Manage your chatbots, review live transcripts, configure automated booking services, and access embeddable widget scripts tailored for your website.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full justify-center">
            <Link
              className="awb-btn inline-flex items-center justify-center text-center shadow-md"
              href="/dashboard"
            >
              Open Dashboard
            </Link>
            <Link
              className="inline-flex items-center justify-center px-[29px] py-[13px] rounded-[4px] border border-[var(--awb-color3)] bg-[var(--awb-color1)] text-[var(--awb-color8)] font-semibold hover:border-[var(--awb-color4)] transition-colors text-center"
              href="/login"
            >
              Client Login
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

