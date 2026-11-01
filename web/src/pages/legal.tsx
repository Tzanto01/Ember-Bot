export default function LegalPage({ doc }: { doc: 'privacy' | 'terms' | 'imprint' }) { return <h1>{{ privacy: 'Privacy', terms: 'Terms', imprint: 'Imprint' }[doc]}</h1>; }
