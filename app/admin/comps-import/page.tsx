import { redirect } from "next/navigation";
export default function CompsImportRedirect() {
  redirect("/admin/sync");
}
