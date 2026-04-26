import { Providers } from "../providers";
import { Header } from "@/components/Header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <Header showWallet={true} />
      {children}
    </Providers>
  );
}
