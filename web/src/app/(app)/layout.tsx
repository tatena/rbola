import AppProviders from "@/components/AppProviders";
import BottomNav from "@/components/BottomNav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
        {children}
        <BottomNav />
      </div>
    </AppProviders>
  );
}
