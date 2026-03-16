import * as React from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">{children}</div>
    </main>
  );
}
