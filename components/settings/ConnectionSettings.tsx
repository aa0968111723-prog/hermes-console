"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type FieldStatus = {
  configured: boolean;
  last4: string | null;
  source: "vault" | "env" | "none";
  value?: string;
};
