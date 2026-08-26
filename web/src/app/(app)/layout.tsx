import BottomNav from "@/components/BottomNav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <a
          href="/catch"
          className="text-lg font-black tracking-[0.25em] text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          RBOLA
        </a>
        <span className="text-xs tracking-[0.3em] text-neutral-600">რბოლა</span>
      </header>
      <div className="flex flex-1 flex-col pb-24">{children}</div>
      <BottomNav />
    </div>
  );
}
