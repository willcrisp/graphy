/** The scrim-plus-dismiss behaviour shared by every modal overlay (SignIn,
 *  AppDialog): a full-screen backdrop that closes on a click outside the
 *  dialog or on Escape. The dialog's own content -- form fields, heading,
 *  buttons -- stays with the caller; this only owns the parts that would
 *  otherwise have to be copied and kept in sync by hand. */

interface Props {
  onClose: () => void
  children: React.ReactNode
}

export default function Modal({ onClose, children }: Props) {
  return (
    <div
      className="scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      {children}
    </div>
  )
}
