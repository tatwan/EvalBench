import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";
import { ReactNode } from "react";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="p-8 max-w-7xl mx-auto w-full min-h-full"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
