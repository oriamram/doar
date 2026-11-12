import { runToastAction, useToasts } from '../lib/toast'

/** Notes that slide up from the bottom like a torn-off receipt, often with an Undo. */
export function Toasts() {
  const toasts = useToasts()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className="toast" data-tone={item.tone}>
          <span className="toast-text">{item.text}</span>
          {item.action && (
            <button className="toast-action" onClick={() => runToastAction(item.id)}>
              {item.action.label}
            </button>
          )}
          {item.countdown && <span className="toast-timer" style={{ animationDuration: `${item.duration}ms` }} aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}
