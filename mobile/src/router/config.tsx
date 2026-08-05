import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import MobileLayout from "../components/feature/MobileLayout";
import ProtectedRoute from "../components/feature/ProtectedRoute";

// Public pages
import ServerConfig from "../pages/server-config/page";
import Login from "../pages/login/page";
import Register from "../pages/register/page";

// Mobile app pages (inside MobileLayout)
import MobileHome from "../pages/mobile-home/page";
import CoursesPage from "../pages/courses/page";
import RecordPage from "../pages/record/page";
import StudyPage from "../pages/study/page";
import ProfilePage from "../pages/profile/page";
import SessionDetailPage from "../pages/session/page";
import SummaryPage from "../pages/summary/page";
import SearchPage from "../pages/search/page";
import SchedulePage from "../pages/schedule/page";
import VoiceprintsPage from "../pages/voiceprints/page";
import SyllabusPage from "../pages/syllabus/page";
import CourseDetailPage from "../pages/course-detail/page";
import HelpPage from "../pages/help/page";

// Existing pages
import TagsPage from "../pages/tags/page";
import SharedPage from "../pages/shared/page";

const routes: RouteObject[] = [
  // Public routes (no auth needed)
  {
    path: "/server-config",
    element: <ServerConfig />,
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
    path: "/shared/:key",
    element: <SharedPage />,
  },
  // Mobile app routes (wrapped in ProtectedRoute + MobileLayout)
  {
    element: (
      <ProtectedRoute>
        <MobileLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "/", element: <MobileHome /> },
      { path: "/courses", element: <CoursesPage /> },
      { path: "/course-detail", element: <CourseDetailPage /> },
      { path: "/record", element: <RecordPage /> },
      { path: "/study", element: <StudyPage /> },
      { path: "/profile", element: <ProfilePage /> },
      { path: "/session/:sid", element: <SessionDetailPage /> },
      { path: "/summary/:sid", element: <SummaryPage /> },
      { path: "/search", element: <SearchPage /> },
      { path: "/schedule", element: <SchedulePage /> },
      { path: "/voiceprints", element: <VoiceprintsPage /> },
      { path: "/syllabus", element: <SyllabusPage /> },
      { path: "/tags", element: <TagsPage /> },
      { path: "/help", element: <HelpPage /> },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;