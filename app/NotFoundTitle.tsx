"use client";

import { useEffect } from "react";

/** The 404 page's tab title: the framework's not-found page takes no metadata of its own. */
export function NotFoundTitle() {
  useEffect(() => { document.title = "Page not found · Ganymede"; }, []);
  return null;
}
