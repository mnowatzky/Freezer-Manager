import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthedLayout } from "./components/AuthedLayout";
import { ToastProvider } from "./lib/toast";
import { installGlobalErrorReporting } from "./lib/report-error";
import { ContainerPage } from "./routes/ContainerPage";
import { ErrorPage } from "./routes/ErrorPage";
import { HomePage } from "./routes/HomePage";
import { JoinPage } from "./routes/JoinPage";
import { LabelsPage } from "./routes/LabelsPage";
import { LoginPage } from "./routes/LoginPage";
import { SettingsPage } from "./routes/SettingsPage";
import { SetupPage } from "./routes/SetupPage";
import "./styles.css";

installGlobalErrorReporting();

// Every route renders ErrorPage when it throws (and for unknown URLs).
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage />, errorElement: <ErrorPage /> },
  { path: "/join/:token", element: <JoinPage />, errorElement: <ErrorPage /> },
  { path: "/labels", element: <LabelsPage />, errorElement: <ErrorPage /> },
  {
    element: <AuthedLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/setup", element: <SetupPage /> },
      { path: "/c/:number", element: <ContainerPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
]);

// Installed app launched by a link (e.g. a scanned container QR code): with launch_handler
// "focus-existing" the running window is focused, not navigated, so route to the link here.
window.launchQueue?.setConsumer(({ targetURL }) => {
  if (!targetURL) return;
  const url = new URL(targetURL);
  if (url.origin !== location.origin) return;
  const path = url.pathname + url.search + url.hash;
  // A fresh launch already loaded the target URL.
  if (path !== location.pathname + location.search + location.hash) void router.navigate(path);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Honors the OS "reduce motion" setting for all springs. */}
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </MotionConfig>
  </StrictMode>,
);
