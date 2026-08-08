import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import AuthGate from "../components/feature/AuthGate";
import RequireAuth from "../components/feature/RequireAuth";
import CoursePage from "../pages/home/page";
import CourseDetailPage from "../pages/course-detail/page";
import ReferencePage from "../pages/reference/page";
import SettingsPage from "../pages/settings/page";
import Login from "../pages/login/page";
import Register from "../pages/register/page";
import TagsPage from "../pages/tags/page";
import SharedPage from "../pages/shared/page";
import HelpPage from "../pages/help/page";

const routes: RouteObject[] = [
  {
    // Shared link: read-only, no login or token required
    path: "/shared/:key",
    element: <SharedPage />,
  },
  {
    path: "/",
    element: <AuthGate />,
  },
  {
    path: "/course",
    element: (
      <RequireAuth>
        <CoursePage />
      </RequireAuth>
    ),
  },
  {
    path: "/tags",
    element: (
      <RequireAuth>
        <TagsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/course-detail",
    element: (
      <RequireAuth>
        <CourseDetailPage />
      </RequireAuth>
    ),
  },
  {
    path: "/reference",
    element: (
      <RequireAuth>
        <ReferencePage />
      </RequireAuth>
    ),
  },
  {
    path: "/settings",
    element: (
      <RequireAuth>
        <SettingsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/help",
    element: (
      <RequireAuth>
        <HelpPage />
      </RequireAuth>
    ),
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/register",
    element: <Register />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;