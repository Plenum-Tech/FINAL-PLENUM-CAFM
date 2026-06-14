import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";

export default function WorkOrdersPage() {
  redirect(APP_ROUTES.workOrdersNew);
}
