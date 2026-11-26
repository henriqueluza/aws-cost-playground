import { useEffect } from 'react';
import { Link } from 'react-router';
import { LegalLinks, Notice } from '../../../shared/ui';
import { splitMarkers, type LegalBlock, type LegalDocument } from '../model/document';
import styles from './LegalPage.module.css';

const SITE = 'AWS Cost Playground';

/** Texto com os marcadores `[...]` destacados. Tudo vira nó de texto; nada de HTML. */
function Text({ value }: { value: string }) {
  return (
    <>
      {splitMarkers(value).map((part, i) =>
        part.marker ? (
          <mark key={i} className={styles.marker}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <Text value={block.text} />
        </p>
      );
    case 'ul':
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>
              <Text value={item} />
            </li>
          ))}
        </ul>
      );
    case 'dl':
      return (
        <dl className={styles.defs}>
          {block.items.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>
                <Text value={item.text} />
              </dd>
            </div>
          ))}
        </dl>
      );
  }
}

/** Página de texto longo (DESIGN.md, "Read"): folha com medida de 68ch, índice e seções com âncora. */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${doc.title} · ${SITE}`;
    return () => {
      document.title = previous;
    };
  }, [doc.title]);

  return (
    <div className={styles.frame}>
      <header className={styles.top}>
        <Link to="/" className={styles.brand}>
          {SITE}
        </Link>
      </header>
      <main className={styles.sheet}>
        <article className={styles.article}>
          <h1 className={styles.title}>{doc.title}</h1>
          <p className={styles.lead}>{doc.lead}</p>
          <Notice
            tone="warning"
            message="Rascunho em revisão pelo responsável. Os trechos entre colchetes ainda serão preenchidos."
          />
          <nav aria-label="Nesta página" className={styles.toc}>
            <h2 className={styles.tocTitle}>Nesta página</h2>
            <ol>
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.heading}</a>
                </li>
              ))}
            </ol>
          </nav>
          {doc.sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id} className={styles.section}>
              <h2 id={s.id}>{s.heading}</h2>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
        </article>
      </main>
      <footer className={styles.bottom}>
        <LegalLinks />
      </footer>
    </div>
  );
}
