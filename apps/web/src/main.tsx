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
  { path: "/etiketten", element: <LabelsPage />, errorElement: <ErrorPage /> },
  {
    element: <AuthedLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/setup", element: <SetupPage /> },
      { path: "/c/:number", element: <ContainerPage /> },
      { path: "/einstellungen", element: <SettingsPage /> },
    ],
  },
]);

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
