import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

/** One dialog for the three app-level actions. `label` present means it asks
 *  for a name; absent means it only asks for a yes -- deleting an app takes its
 *  whole graph with it, which is the one destructive action worth a stop. */
export interface DialogSpec {
  title: string
  body?: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel: string
  danger?: boolean
  onSubmit: (value: string) => Promise<void>
}

interface Props {
  dialog: DialogSpec
  onClose: () => void
}

export default function AppDialog({ dialog, onClose }: Props) {
  const [value, setValue] = useState(dialog.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)

  // The name is pre-selected so a rename is one keystroke away; the confirm-only
  // form has nothing to type into, so the button itself takes focus.
  useEffect(() => {
    if (input.current) {
      input.current.focus()
      input.current.select()
    } else {
      confirm.current?.focus()
    }
  }, [])

  const named = dialog.label !== undefined
  const ready = !busy && (!named || value.trim().length > 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await dialog.onSubmit(value.trim())
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work.')
      setBusy(false)
      input.current?.focus()
    }
  }

  return (
    <Modal onClose={onClose}>
      <form
        className="signin"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <h2 id="app-dialog-title" className="signin__title mono">
          {dialog.title}
        </h2>
        {dialog.body ? <p className="signin__body">{dialog.body}</p> : null}
        {named ? (
          <label className="field">
            <span className="field__label mono">{dialog.label}</span>
            <input
              ref={input}
              type="text"
              className="field__input"
              value={value}
              maxLength={128}
              placeholder={dialog.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p className="signin__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="signin__row">
          <button
            ref={confirm}
            type="submit"
            className={`button ${dialog.danger ? 'button--danger' : 'button--primary'}`}
            disabled={!ready}
          >
            {busy ? 'Working…' : dialog.confirmLabel}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
