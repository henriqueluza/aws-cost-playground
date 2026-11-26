import { useEffect, useState, type ChangeEvent } from 'react';
import { Button, Dialog, SelectField } from '../../../shared/ui';
import { useDesignStore } from '../hooks/useDesignStore';
import { parseRegion, REGION_OPTIONS } from '../model/regionOptions';
import { hasUnsavedChanges } from '../model/unsaved';
import styles from './ActionBar.module.css';
import { DesignFileActions } from './DesignFileActions';
import pageStyles from './EditorPage.module.css';

/**
 * Barra de ações da moldura (DESIGN.md, "A casca do editor"). Aqui: região do design e "Novo
 * design". As outras ações da barra (arquivo, conta) entram por suas Issues, ao lado destas.
 */
export function ActionBar() {
  const region = useDesignStore((s) => s.document.region);
  const unsaved = useDesignStore((s) => hasUnsavedChanges(s.document, s.baseline));
  const setRegion = useDesignStore((s) => s.setRegion);
  const newDesign = useDesignStore((s) => s.newDesign);
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  // Fechar ou recarregar a aba com alteração pendente também perderia o design: o navegador avisa.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const create = () => {
    newDesign();
    setConfirming(false);
    setAnnouncement('Novo design criado a partir do template.');
  };
  const onRegion = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = parseRegion(event.target.value);
    if (next && setRegion(next).ok)
      setAnnouncement(`Região alterada para ${next}. Preços recalculados.`);
  };

  return (
    <>
      <h2 className={pageStyles.hidden}>Ações</h2>
      <div className={pageStyles.actions}>
        <div className={styles.region}>
          <SelectField label="Região" value={region} onChange={onRegion}>
            {REGION_OPTIONS.map(({ value, text }) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </SelectField>
        </div>
        <Button onClick={() => (unsaved ? setConfirming(true) : create())}>Novo design</Button>
        <DesignFileActions />
      </div>
      <p role="status" className={pageStyles.hidden}>
        {announcement}
      </p>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Descartar as alterações?"
      >
        <p className={styles.dialogText}>
          O design atual tem alterações que não foram salvas. Se você criar um novo design a partir
          do template, elas serão perdidas.
        </p>
        <div className={styles.dialogActions}>
          <Button onClick={() => setConfirming(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={create}>
            Descartar e criar novo design
          </Button>
        </div>
      </Dialog>
    </>
  );
}
