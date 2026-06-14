import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/constants";

export default async function ManpowerPage() {
  redirect(APP_ROUTES.technicians);
}
