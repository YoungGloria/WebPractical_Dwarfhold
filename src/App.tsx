import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Layout } from "./pages/Layout";
import { ColonyPage } from "./pages/ColonyPage";
import { ForgePage } from "./pages/ForgePage";
import { ColonyProvider } from "./state/ColonyProvider";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <ColonyPage /> },
      { path: "forge", element: <ForgePage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <ColonyProvider>
      <RouterProvider router={router} />
    </ColonyProvider>
  );
}
