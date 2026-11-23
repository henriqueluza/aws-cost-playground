import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import styles from './Field.module.css';
import { NumberField, SelectField, TextField, type FieldBaseProps } from './index';

const css = () => parseCss(readRepoFile('web/src/shared/ui/Field.module.css'));
const cls = (key: string) => styles[key] ?? `sem-${key}`;
const box = (control: HTMLElement) => control.closest(`.${cls('control')}`); // caixa com borda
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & 4);
const error = 'Use um valor entre 0 e 10.000 GB/mês.';
const stateClass = { 'Com erro': 'invalid', Desabilitado: 'disabled', Diálogo: 'form' };
const options = [<option key="e">us-east-1</option>, <option key="w">us-west-2</option>];
type Native = { disabled?: boolean; placeholder?: string; onChange?: () => void };
type Props = FieldBaseProps & Native;
const cases: [string, 'textbox' | 'combobox', (p: Props) => ReactNode][] = [
  ['TextField', 'textbox', (p) => <TextField {...p} />],
  ['NumberField', 'textbox', (p) => <NumberField {...p} />],
  ['SelectField', 'combobox', (p) => <SelectField {...p}>{options}</SelectField>],
];
const states: Props[] = [
  { label: 'Normal', placeholder: 'ex.: 100' },
  { label: 'Com erro', error },
  { label: 'Desabilitado', disabled: true },
  { label: 'Diálogo', density: 'form' },
  { label: '<b>x</b>', error: '<img src=x onerror=alert(1)>' },
];

it.each(cases)('%s: rótulo, erro, desabilitado, caixa, sem HTML e axe', async (_n, role, ui) => {
  const { container } = render(states.map((s) => <Fragment key={s.label}>{ui(s)}</Fragment>));
  const get = (name: string) => screen.getByRole(role, { name });
  const [normal, label] = [get('Normal'), screen.getByText('Normal')];
  expect(label).toHaveClass(cls('label'));
  expect(follows(label, normal)).toBe(true);
  expect(screen.queryByRole(role, { name: 'ex.: 100' })).toBeNull();
  expect(normal.getAttributeNames().filter((a) => a.startsWith('aria-'))).toEqual([]);
  expect(get('Com erro')).toHaveAttribute('aria-invalid', 'true');
  expect(get('Com erro')).toHaveAccessibleDescription(error);
  const message = screen.getByText(error).closest('p');
  expect(message?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(message).toHaveClass(cls('error'));
  await userEvent.keyboard('{Tab}{Tab}{Tab}'); // Normal, Com erro e Diálogo: pula o desabilitado.
  expect(get('Diálogo')).toHaveFocus();
  for (const k of Object.values(stateClass)) expect(box(normal)).not.toHaveClass(cls(k));
  for (const [n, k] of Object.entries(stateClass)) expect(box(get(n))).toHaveClass(cls(k));
  expect(container.querySelector('b, img')).toBeNull();
  await expectNoAxeViolations(container);
});

it('são <input type="text"> e <select> nativo; Tab os foca em ordem e onChange dispara', async () => {
  const onChange = vi.fn();
  render(cases.map(([n, , ui]) => <Fragment key={n}>{ui({ label: n, onChange })}</Fragment>));
  const [text, number] = screen.getAllByRole('textbox');
  const select = screen.getByRole('combobox', { name: 'SelectField' });
  for (const input of [text, number]) expect(input).toHaveAttribute('type', 'text');
  expect(select.tagName).toBe('SELECT');
  expect(select.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  for (const control of [text, select]) expect(control).not.toHaveClass(cls('bare'));
  await userEvent.keyboard('{Tab}api{Tab}12,5{Tab}');
  expect(number).toHaveValue('12,5');
  expect(select).toHaveFocus();
  await userEvent.selectOptions(select, 'us-west-2');
  expect(select).toHaveValue('us-west-2');
  expect(onChange).toHaveBeenCalledTimes(8); // 'api' + '12,5' + a seleção
});
it('NumberField: inputMode, unidade na caixa à direita e descrita antes do erro', async () => {
  render(<NumberField label="Uso" unit="GB/mês" />);
  const [input, unit] = [screen.getByRole('textbox', { name: 'Uso' }), screen.getByText('GB/mês')];
  expect(input).toHaveAttribute('inputmode', 'decimal');
  expect(input).toHaveClass(cls('bare'));
  expect(box(input)).toHaveClass(cls('affix'));
  expect(box(input)).toContainElement(unit);
  expect(unit).toHaveClass(cls('unit'));
  expect(follows(input, unit)).toBe(true);
  expect(input).toHaveAccessibleDescription('GB/mês');
  await userEvent.click(unit); // a unidade faz parte do alvo
  expect(input).toHaveFocus();
  render(<NumberField label="Nós" unit="<i>nós</i>" inputMode="numeric" error={error} />);
  const count = screen.getByRole('textbox', { name: 'Nós' });
  expect(count).toHaveAttribute('inputmode', 'numeric');
  expect(count).toHaveAccessibleDescription(`<i>nós</i> ${error}`);
  expect(document.querySelector('i')).toBeNull();
  for (const root of document.body.children) await expectNoAxeViolations(root);
});
const expected = parseCss(`
  .label { font-size: var(--fs-small); color: var(--muted); font-weight: var(--fw-medium) }
  .control { height: var(--control-height); background-color: var(--surface);
    border: var(--border-width) solid var(--control); border-radius: var(--radius-control) }
  .form { height: var(--control-height-form) } .control:focus-within { border-color: var(--accent) }
  .control::placeholder, .bare::placeholder { color: var(--faint); opacity: 1 }
  .bare:focus-visible { outline: none } .affix { font-variant-numeric: tabular-nums }
  .affix:has(.bare:focus-visible) { outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset) } .unit { color: var(--faint) }
  .invalid, .invalid:focus-within { border-color: var(--negative) }
  .disabled { background-color: var(--raised); border-color: var(--border); color: var(--faint);
    cursor: not-allowed } .error { color: var(--negative); font-size: var(--fs-small) }
`);
it.each(Object.entries(expected))('Field.module.css: %s segue o DESIGN.md', (selector, decls) => {
  expect(css()[selector]).toMatchObject(decls);
});
it('Field.module.css: .disabled sem opacity, sem hex/px, só .bare:focus-visible zera outline', () => {
  const all = Object.entries(css());
  expect(css()['.disabled']).not.toHaveProperty('opacity');
  expect(all.flatMap(([, d]) => Object.values(d)).filter((v) => /#|\d\s*px\b/.test(v))).toEqual([]);
  const zeroed = all.filter(([, d]) => /"outline[^"]*":"(none|0)\b/.test(JSON.stringify(d)));
  expect(zeroed.map(([selector]) => selector)).toEqual(['.bare:focus-visible']);
});
