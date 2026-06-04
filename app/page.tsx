/* Phase 0 placeholder home page. Confirms the app boots and the locked design
   tokens (fonts, colours, type scale) are wired. The real landing page (05 ·
   Home Page) is built in Phase 3. */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-chat flex-col justify-center gap-6 px-6 py-20">
      <p className="font-mono text-label uppercase text-primary-600">
        Phase 0 · Scaffold
      </p>
      <h1 className="font-serif text-display text-text">
        Hotel<span className="text-primary">Zippo</span>
      </h1>
      <p className="max-w-card text-body-lg text-text-secondary">
        One confident recommendation.{' '}
        <em className="font-serif text-primary-600">No more research spiral.</em>
      </p>
      <p className="max-w-card text-body text-text-tertiary">
        The app shell is up and the design tokens are wired. The conversational
        experience is built in Phase 3.
      </p>
    </main>
  );
}
