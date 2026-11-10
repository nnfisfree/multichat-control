import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ActionDef, type Platform } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { useStore } from '../lib/store'

interface Props {
  scope: Platform | 'all'
  onClose(): void
  onRewards(): void
}

export function ActionDeck({ scope, onClose, onRewards }: Props): JSX.Element {
  const [platform, setPlatform] = useState<Platform>(scope === 'all' ? 'twitch' : scope)
  const [actions, setActions] = useState<ActionDef[] | null>(null)
  const [form, setForm] = useState<ActionDef | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [pendingConfirm, setPendingConfirm] = useState<ActionDef | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const confirmOn = useStore((s) => s.settings?.confirmActions)
  const version = useStore((s) => s.actionsVersion[platform] ?? 0)

  const load = useCallback(() => {
    window.nnf.actions(platform).then(setActions, () => setActions([]))
  }, [platform])
  // Reloads when the platform reports a change, and every 30 seconds for platforms that can't.
  useEffect(load, [load, version])
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const run = async (a: ActionDef, args: Record<string, string>): Promise<void> => {
    const r = await window.nnf.runAction(platform, a.id, args)
    setNote({ ok: r.ok, text: r.message ?? (r.ok ? `${a.label} done.` : `${a.label} failed.`) })
    setForm(null)
    setPendingConfirm(null)
    load()
  }

  const click = (a: ActionDef): void => {
    setNote(null)
    if (a.fields?.length) {
      setForm(a)
      setValues(Object.fromEntries(a.fields.map((f) => [f.key, f.default ?? ''])))
    } else if (a.confirm && confirmOn) setPendingConfirm(a)
    else void run(a, {})
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!form) return
    if (form.confirm && confirmOn && !pendingConfirm) setPendingConfirm(form)
    else void run(form, values)
  }

  const groups = new Map<string, ActionDef[]>()
  for (const a of actions ?? []) {
    if (!groups.has(a.group)) groups.set(a.group, [])
    groups.get(a.group)!.push(a)
  }

  return (
    <div className="popover deck" role="dialog" aria-label="Actions">
      <div className="pop-head">
        <h2>Actions</h2>
        <div className="filters">
          {PLATFORMS.map((p) => (
            <button key={p} className={p === platform ? `pf-toggle on ${p}` : `pf-toggle ${p}`} aria-pressed={p === platform} title={PLATFORM_LABEL[p]}
              onClick={() => { setPlatform(p); setActions(null); setForm(null); setPendingConfirm(null); setNote(null) }}><PlatformIcon platform={p} size={16} /></button>
          ))}
        </div>
        <div className="grow" />
        <button className="icon-btn" aria-label="Close actions" onClick={onClose}><Icon.close /></button>
      </div>
      {note && <div className={note.ok ? 'notice good' : 'notice bad'} role="status">{note.text}</div>}
      <div className="deck-scroll">
        {platform === 'twitch' && <button className="btn wide" onClick={onRewards}>Open Twitch Rewards &amp; Power-ups</button>}
        {!actions && <div className="empty">Loading…</div>}
        {actions?.length === 0 && <div className="empty">No actions available. Log in to {PLATFORM_LABEL[platform]} first.</div>}
        {[...groups].map(([group, list]) => (
          <section key={group}>
            <h3>{group}</h3>
            <div className="deck-grid">
              {list.map((a) => (
                <button key={a.id} className={`deck-btn${a.active ? ' active' : ''}`} disabled={a.disabled} title={a.note} aria-pressed={a.active} onClick={() => click(a)}>{a.label}</button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {pendingConfirm && (
        <div className="sheet" role="alertdialog">
          <p>{pendingConfirm.confirm}</p>
          <div className="row-btns">
            <button className="btn" onClick={() => void run(pendingConfirm, form ? values : {})}>Yes, do it</button>
            <button className="btn ghost" onClick={() => setPendingConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {form && !pendingConfirm && (
        <form className="sheet" onSubmit={submit}>
          <h3>{form.label}</h3>
          {form.fields!.map((f) => (
            <label key={f.key}>{f.label}
              {f.type === 'select'
                ? <select value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                : f.type === 'lines'
                  ? <textarea rows={3} required={f.required} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  : <input type={f.type} required={f.required} placeholder={f.placeholder} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
            </label>
          ))}
          <div className="row-btns">
            <button className="btn" type="submit">Go</button>
            <button className="btn ghost" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
