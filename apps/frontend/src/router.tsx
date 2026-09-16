import { createBrowserRouter, Navigate } from 'react-router';

import { PlannerPage, ProfilePage, ShoppingPage } from './features/pages';
import { AppShell } from './features/shell/AppShell';
import { ROUTES } from './features/shell/navigation';
import { ItemDetailsDialog } from './features/storage/ItemDetailsDialog';
import { StoragePage } from './features/storage/StoragePage';

/**
 * React Router 8, data mode. Created once, outside React, as the router docs
 * require. Data comes from the MobX stores rather than route loaders, so the
 * routes carry components only.
 *
 * `/storage` alone redirects to the first location; an item's details are a
 * child of its location, rendered over the list.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    children: [
      { index: true, element: <Navigate replace to={ROUTES.storage} /> },
      { path: ROUTES.storage, Component: StoragePage },
      {
        path: `${ROUTES.storage}/:locationId`,
        Component: StoragePage,
        children: [{ path: 'items/:itemId', Component: ItemDetailsDialog }],
      },
      { path: ROUTES.shopping, Component: ShoppingPage },
      { path: ROUTES.planner, Component: PlannerPage },
      { path: ROUTES.profile, Component: ProfilePage },
      { path: '*', element: <Navigate replace to={ROUTES.storage} /> },
    ],
  },
]);
