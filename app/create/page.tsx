import type { Metadata } from "next";
import SillyWorld from "@/components/silly-world/SillyWorld";

export const metadata: Metadata = {
  title: "傻的創作小天地",
  description: "粉彩互動舞台：水光火森。本地問候，尚未接上真實生成。",
};

export default function CreatePage() {
  return <SillyWorld />;
}
