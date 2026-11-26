import { Link } from 'react-router';
import styles from './LegalLinks.module.css';

/** Links para as páginas legais. Vai no rodapé do editor e no das próprias páginas legais. */
export function LegalLinks() {
  return (
    <nav aria-label="Informações legais" className={styles.nav}>
      <Link to="/privacidade" className={styles.link}>
        Privacidade
      </Link>
      <Link to="/termos" className={styles.link}>
        Termos de uso
      </Link>
    </nav>
  );
}
