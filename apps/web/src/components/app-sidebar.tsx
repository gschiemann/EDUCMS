"use client"

import * as React from "react"
import { LayoutDashboard, MonitorPlay, ListVideo, Settings2, LogOut, Upload } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useUIStore } from "@/store/ui-store"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const pathname = usePathname()
  const user = useUIStore((state) => state.user)
  const logout = useUIStore((state) => state.logout)

  // Extract tenant ID from URL path (e.g., /00000000-.../dashboard → 00000000-...)
  const tenantId = user?.tenantId || pathname.split('/')[1] || ''
  const base = `/${tenantId}`

  const menuItems = [
    { title: "Dashboard", url: `${base}/dashboard`, icon: LayoutDashboard },
    { title: "Screens", url: `${base}/screens`, icon: MonitorPlay },
    { title: "Assets", url: `${base}/assets`, icon: Upload },
    { title: "Playlists", url: `${base}/playlists`, icon: ListVideo },
    { title: "Settings", url: `${base}/settings`, icon: Settings2 },
  ]


  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar/60 backdrop-blur-2xl text-sidebar-foreground shadow-2xl">
      <SidebarHeader className="border-b border-sidebar-border p-6">
        <h2 className="text-xl font-bold tracking-tight text-sidebar-foreground flex items-center gap-2">
          <div className="bg-primary/10 p-1.5 rounded-lg edu-glow">
            <MonitorPlay className="w-6 h-6 text-primary" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-indigo-400 font-extrabold">EduSignage</span>
        </h2>
        {user && (
          <p className="text-xs text-sidebar-foreground/60 mt-1 truncate">{user.email}</p>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-neutral-400">Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = pathname === item.url || pathname.endsWith(item.url.split('/').pop() || '')
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={isActive}
                      className={
                        isActive
                          ? 'bg-primary text-primary-foreground font-medium shadow-md shadow-primary/20 rounded-xl'
                          : 'hover:bg-primary/10 hover:text-primary transition-all font-medium text-sidebar-foreground/80 rounded-xl'
                      }
                      render={<Link href={item.url} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors w-full px-3 py-2 rounded-xl font-medium"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </SidebarFooter>
    </Sidebar>
  )
}

