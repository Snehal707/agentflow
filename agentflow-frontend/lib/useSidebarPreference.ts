"use client";

import { useCallback, useEffect, useState } from "react";

const SIDEBAR_STORAGE_KEY = "agentflow.sidebar.collapsed";

export const sidebarWidthClass = {
  expanded: "w-64",
  collapsed: "w-20",
} as const;

export const sidebarOffsetClass = {
  expanded: "md:ml-64",
  collapsed: "md:ml-20",
} as const;

export const sidebarPaddingClass = {
  expanded: "md:pl-64",
  collapsed: "md:pl-20",
} as const;

export const topNavSidebarPaddingClass = {
  expanded: "md:pl-[17rem]",
  collapsed: "md:pl-24",
} as const;

export function useSidebarPreference() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    try {
      setIsCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1");
    } catch {
      setIsCollapsed(false);
    }
  }, []);

  const updateCollapsed = useCallback((next: boolean) => {
    setIsCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    updateCollapsed(!isCollapsed);
  }, [isCollapsed, updateCollapsed]);

  return {
    isCollapsed,
    setCollapsed: updateCollapsed,
    toggleSidebar,
  };
}
