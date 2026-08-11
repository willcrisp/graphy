import { useEffect, useRef, useState } from 'react'

interface Props {
  onSubmit: (password: string) => Promise<void>
  onClose: () => void
}

export default function SignIn({ onSubmit, onClose }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-in failed.')
      setPassword('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <form
        className="signin"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
      >
        <h2 id="signin-title" className="signin__title mono">
          Admin sign-in
        </h2>
        <label className="field">
          <span className="field__label mono">Password</span>
          <input
            ref={input}
            type="password"
            className="field__input"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? (
          <p className="signin__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="signin__row">
          <button type="submit" className="button button--primary" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
