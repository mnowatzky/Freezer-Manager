import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthedLayout } from "./components/AuthedLayout";
import { ToastProvider } from "./lib/toast";
import { ContainerPage } from "./routes/ContainerPage";
import { HomePage } from "./routes/HomePage";
import { JoinPage } from "./routes/JoinPage";
import { LabelsPage } from "./routes/LabelsPage";
import { LoginPage } from "./routes/LoginPage";
import { SettingsPage } from "./routes/SettingsPage";
import { SetupPage } from "./routes/SetupPage";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/join/:token", element: <JoinPage /> },
  { path: "/etiketten", element: <LabelsPage /> },
  {
    element: <AuthedLayout />,
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
