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
import MeetingPage from "../pages/meeting/page";

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
    path: "/meeting",
    element: (
      <RequireAuth>
        <MeetingPage />
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

// Optional private extras for this deployment (src/localExtras.tsx is not part of the public repo).
// The glob resolves to nothing when the file is absent, so the public build just has no extra routes.
const localMods = import.meta.glob<{ extraRoutes?: RouteObject[] }>("../localExtras.tsx", { eager: true });
for (const m of Object.values(localMods)) routes.push(...(m.extraRoutes ?? []));

export default routes;