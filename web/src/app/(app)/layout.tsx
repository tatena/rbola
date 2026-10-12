import AppProviders from "@/components/AppProviders";
import BottomNav from "@/components/BottomNav";
import FirstCarGate from "@/components/FirstCarGate";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
        {/* onboarding: no car yet → only the camera is open */}
        <FirstCarGate>{children}</FirstCarGate>
        <BottomNav />
      </div>
    </AppProviders>
  );
}
