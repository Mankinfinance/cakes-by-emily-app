import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { placeholderParts, type LegalDocument } from "@/lib/domain/legal";

/** Text with [placeholders] shown in their own style, so Emily can spot what's left to fill in. */
function WithPlaceholders({ text }: { text: string }) {
  return (
    <>
      {placeholderParts(text).map((p, i) =>
        p.placeholder ? (
          <mark key={i} className="rounded bg-[#fbf3e6] px-1 font-semibold text-gold" data-testid="legal-placeholder">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function LegalPage({ doc, banner, extra }: { doc: LegalDocument; banner: boolean; extra?: string }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 leading-relaxed" data-testid="legal-doc">
        <h1 className="font-serif text-3xl">{doc.title}</h1>
        {banner && (
          <p className="mt-3 rounded-xl border-2 border-gold bg-[#fbf3e6] px-4 py-3 text-sm font-semibold" role="note" data-testid="legal-draft-banner">
            Draft for review. Not legal advice.
          </p>
        )}
        <p className="mt-3">{doc.intro}</p>
        {doc.sections.map((s, i) => (
          <section key={s.heading} className="mt-7" data-testid={`legal-section-${i + 1}`}>
            <h2 className="font-serif text-xl">{s.heading}</h2>
            {s.paras?.map((p) => (
              <p key={p} className="mt-2">
                <WithPlaceholders text={p} />
              </p>
            ))}
            {s.bullets && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {s.bullets.map((b) => (
                  <li key={b}>
                    <WithPlaceholders text={b} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {extra && (
          <section className="mt-7" data-testid="legal-extra">
            <h2 className="font-serif text-xl">Additional notes</h2>
            <p className="mt-2 whitespace-pre-line">
              <WithPlaceholders text={extra} />
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
