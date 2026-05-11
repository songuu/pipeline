import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SnapshotProvider } from "./lib/snapshot-context";

export const metadata: Metadata = {
  title: "部署管理 · CI/CD 平台",
  description: "Nest + Next + Tekton CI/CD 控制台",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <SnapshotProvider>{children}</SnapshotProvider>
      </body>
    </html>
  );
}
