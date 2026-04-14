"use client"

import * as React from "react"
import { LayoutDashboard, MonitorPlay, ListVideo, AlertTriangle, Settings2, Users } from "lucide-react"

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
} from "@/components/ui/sidebar"

const menuItems = [
  { title: "Dashboard", url: "#", icon: LayoutDashboard },
  { title: "Screens", url: "#", icon: MonitorPlay },
  { title: "Playlists", url: "#", icon: ListVideo },
  { title: "Users & Roles", url: "#", icon: Users },
  { title: "Emergency Override", url: "#", icon: AlertTriangle, variant: "destructive" },
  { title: "Settings", url: "#", icon: Settings2 },
]

export function AppSidebar() {
  return (
    <Sidebar className="border-r border-neutral-800 bg-neutral-900 text-white">
      <SidebarHeader className="border-b border-neutral-800 p-4">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <MonitorPlay className="w-6 h-6 text-indigo-500" />
          EDU CMS
        </h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-neutral-400">Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    className={item.variant === 'destructive' ? 'text-red-400 hover:text-red-300 hover:bg-neutral-800' : 'hover:bg-neutral-800'}
                  >
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
