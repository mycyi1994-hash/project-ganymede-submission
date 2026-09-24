export default function DataNotice({ title, children, onRetry, loading = false }: {
  title: string;
  children: React.ReactNode;
  onRetry?: () => void;
  loading?: boolean;
}) {
  return <div className="data-notice" role="status">
    <span className="data-notice-mark" aria-hidden="true">i</span>
    <div><strong>{title}</strong><p>{children}</p></div>
    {onRetry && <button type="button" disabled={loading} onClick={onRetry}>{loading ? "Checking…" : "Try again"}<span aria-hidden="true"> ↻</span></button>}
  </div>;
}
