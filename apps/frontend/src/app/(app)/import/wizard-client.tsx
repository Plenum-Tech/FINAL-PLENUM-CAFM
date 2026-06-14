"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ImportWizard } from "@/features/import/wizard/Wizard";

export function ImportWizardLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Launch Wizard</Button>
      <ImportWizard open={open} onClose={() => setOpen(false)} />
    </>
  );
}

