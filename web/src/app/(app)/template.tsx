// re-mounts on every route change inside the app shell — gives each page a
// quiet entrance while the layout (and bottom nav) stay perfectly still
export default function Template({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="page-enter flex min-h-0 flex-1 flex-col">{children}</div>;
}
