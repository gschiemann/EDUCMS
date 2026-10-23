import type { SystemPreset } from './system-presets';
export const DIRECTORY_TEMPLATE_PRESETS: SystemPreset[] = [
  {
    "name": "Corporate · Directory · Pacific Editorial",
    "description": "Commercial real estate directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#f2ede4",
    "id": "preset-corporate-directory-pacific-editorial-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/pacific-editorial-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "pacific-editorial",
            "orientation": "landscape",
            "dataset": {
              "title": "Meridian Exchange",
              "subtitle": "Financial district · Main lobby",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "commercial-001",
                  "name": "Alder & Finch Partners",
                  "suite": "101",
                  "floor": "1",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-002",
                  "name": "Atlas Land Company",
                  "suite": "102",
                  "floor": "1",
                  "category": "Property group",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-003",
                  "name": "Bellweather Legal",
                  "suite": "103",
                  "floor": "1",
                  "category": "Legal services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-004",
                  "name": "Birchline Capital",
                  "suite": "201",
                  "floor": "2",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-005",
                  "name": "Cedar Point Insurance",
                  "suite": "202",
                  "floor": "2",
                  "category": "Insurance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-006",
                  "name": "Civic Arc Planning",
                  "suite": "203",
                  "floor": "2",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-007",
                  "name": "Cobalt Commercial",
                  "suite": "301",
                  "floor": "3",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-008",
                  "name": "Crownwell Advisory",
                  "suite": "302",
                  "floor": "3",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-009",
                  "name": "Eastbridge Equity",
                  "suite": "303",
                  "floor": "3",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-010",
                  "name": "Evergreen Trust",
                  "suite": "401",
                  "floor": "4",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-011",
                  "name": "Fieldstone Accounting",
                  "suite": "402",
                  "floor": "4",
                  "category": "Accounting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-012",
                  "name": "Form & Function Architects",
                  "suite": "403",
                  "floor": "4",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-013",
                  "name": "Granite Bay Partners",
                  "suite": "501",
                  "floor": "5",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-014",
                  "name": "Harbourlight Estates",
                  "suite": "502",
                  "floor": "5",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-015",
                  "name": "Juniper Asset Management",
                  "suite": "503",
                  "floor": "5",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-016",
                  "name": "Keystone Strategies",
                  "suite": "601",
                  "floor": "6",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-017",
                  "name": "Linden & Rowe",
                  "suite": "602",
                  "floor": "6",
                  "category": "Legal services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-018",
                  "name": "Mariner Wealth Studio",
                  "suite": "603",
                  "floor": "6",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-019",
                  "name": "Northstar Valuation",
                  "suite": "701",
                  "floor": "7",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-020",
                  "name": "Oak & Origin Group",
                  "suite": "702",
                  "floor": "7",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-021",
                  "name": "Parkline Financial",
                  "suite": "703",
                  "floor": "7",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-022",
                  "name": "Quarry Risk Partners",
                  "suite": "801",
                  "floor": "8",
                  "category": "Insurance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-023",
                  "name": "Redwood Tax Advisors",
                  "suite": "802",
                  "floor": "8",
                  "category": "Accounting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-024",
                  "name": "Seabrook Commercial",
                  "suite": "803",
                  "floor": "8",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-025",
                  "name": "Terrace Legal Collective",
                  "suite": "901",
                  "floor": "9",
                  "category": "Legal services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-026",
                  "name": "Union Square Analytics",
                  "suite": "902",
                  "floor": "9",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-027",
                  "name": "Vantage Civic Design",
                  "suite": "903",
                  "floor": "9",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-028",
                  "name": "Westhaven Partners",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-029",
                  "name": "Willowgate Holdings",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Property group",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-030",
                  "name": "Zephyr Planning Studio",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Pacific Editorial — Portrait",
    "description": "Commercial real estate directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#f2ede4",
    "id": "preset-corporate-directory-pacific-editorial-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/pacific-editorial-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "pacific-editorial",
            "orientation": "portrait",
            "dataset": {
              "title": "Meridian Exchange",
              "subtitle": "Financial district · Main lobby",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "commercial-001",
                  "name": "Alder & Finch Partners",
                  "suite": "101",
                  "floor": "1",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-002",
                  "name": "Atlas Land Company",
                  "suite": "102",
                  "floor": "1",
                  "category": "Property group",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-003",
                  "name": "Bellweather Legal",
                  "suite": "103",
                  "floor": "1",
                  "category": "Legal services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-004",
                  "name": "Birchline Capital",
                  "suite": "201",
                  "floor": "2",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-005",
                  "name": "Cedar Point Insurance",
                  "suite": "202",
                  "floor": "2",
                  "category": "Insurance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-006",
                  "name": "Civic Arc Planning",
                  "suite": "203",
                  "floor": "2",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-007",
                  "name": "Cobalt Commercial",
                  "suite": "301",
                  "floor": "3",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-008",
                  "name": "Crownwell Advisory",
                  "suite": "302",
                  "floor": "3",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-009",
                  "name": "Eastbridge Equity",
                  "suite": "303",
                  "floor": "3",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-010",
                  "name": "Evergreen Trust",
                  "suite": "401",
                  "floor": "4",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-011",
                  "name": "Fieldstone Accounting",
                  "suite": "402",
                  "floor": "4",
                  "category": "Accounting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-012",
                  "name": "Form & Function Architects",
                  "suite": "403",
                  "floor": "4",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-013",
                  "name": "Granite Bay Partners",
                  "suite": "501",
                  "floor": "5",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-014",
                  "name": "Harbourlight Estates",
                  "suite": "502",
                  "floor": "5",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-015",
                  "name": "Juniper Asset Management",
                  "suite": "503",
                  "floor": "5",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-016",
                  "name": "Keystone Strategies",
                  "suite": "601",
                  "floor": "6",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-017",
                  "name": "Linden & Rowe",
                  "suite": "602",
                  "floor": "6",
                  "category": "Legal services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-018",
                  "name": "Mariner Wealth Studio",
                  "suite": "603",
                  "floor": "6",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-019",
                  "name": "Northstar Valuation",
                  "suite": "701",
                  "floor": "7",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-020",
                  "name": "Oak & Origin Group",
                  "suite": "702",
                  "floor": "7",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-021",
                  "name": "Parkline Financial",
                  "suite": "703",
                  "floor": "7",
                  "category": "Financial services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-022",
                  "name": "Quarry Risk Partners",
                  "suite": "801",
                  "floor": "8",
                  "category": "Insurance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-023",
                  "name": "Redwood Tax Advisors",
                  "suite": "802",
                  "floor": "8",
                  "category": "Accounting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-024",
                  "name": "Seabrook Commercial",
                  "suite": "803",
                  "floor": "8",
                  "category": "Real estate",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-025",
                  "name": "Terrace Legal Collective",
                  "suite": "901",
                  "floor": "9",
                  "category": "Legal services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-026",
                  "name": "Union Square Analytics",
                  "suite": "902",
                  "floor": "9",
                  "category": "Consulting",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-027",
                  "name": "Vantage Civic Design",
                  "suite": "903",
                  "floor": "9",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-028",
                  "name": "Westhaven Partners",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Investment advisory",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-029",
                  "name": "Willowgate Holdings",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Property group",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "commercial-030",
                  "name": "Zephyr Planning Studio",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Elevator Stack",
    "description": "Corporate directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#e9efec",
    "id": "preset-corporate-directory-elevator-stack-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/elevator-stack-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "elevator-stack",
            "orientation": "landscape",
            "dataset": {
              "title": "Northline Headquarters",
              "subtitle": "Workplace campus · Reception",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "corporate-001",
                  "name": "Reception & Visitor Services",
                  "suite": "101",
                  "floor": "1",
                  "category": "Guest services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-002",
                  "name": "People & Culture",
                  "suite": "102",
                  "floor": "1",
                  "category": "People",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-003",
                  "name": "Learning & Development",
                  "suite": "103",
                  "floor": "1",
                  "category": "People",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-004",
                  "name": "Workplace Experience",
                  "suite": "201",
                  "floor": "2",
                  "category": "People",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-005",
                  "name": "Brand & Communications",
                  "suite": "202",
                  "floor": "2",
                  "category": "Marketing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-006",
                  "name": "Customer Success",
                  "suite": "203",
                  "floor": "2",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-007",
                  "name": "Product Design",
                  "suite": "301",
                  "floor": "3",
                  "category": "Product",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-008",
                  "name": "Research & Insights",
                  "suite": "302",
                  "floor": "3",
                  "category": "Product",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-009",
                  "name": "Engineering Studio",
                  "suite": "303",
                  "floor": "3",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-010",
                  "name": "Cloud Operations",
                  "suite": "401",
                  "floor": "4",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-011",
                  "name": "Information Security",
                  "suite": "402",
                  "floor": "4",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-012",
                  "name": "Finance & Accounting",
                  "suite": "403",
                  "floor": "4",
                  "category": "Finance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-013",
                  "name": "Legal & Compliance",
                  "suite": "501",
                  "floor": "5",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-014",
                  "name": "Executive Office",
                  "suite": "502",
                  "floor": "5",
                  "category": "Leadership",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-015",
                  "name": "Boardroom North",
                  "suite": "503",
                  "floor": "5",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-016",
                  "name": "Boardroom South",
                  "suite": "601",
                  "floor": "6",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-017",
                  "name": "Orchard Meeting Rooms",
                  "suite": "602",
                  "floor": "6",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-018",
                  "name": "Cedar Collaboration Hub",
                  "suite": "603",
                  "floor": "6",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-019",
                  "name": "Innovation Lab",
                  "suite": "701",
                  "floor": "7",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-020",
                  "name": "Community Lounge",
                  "suite": "702",
                  "floor": "7",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-021",
                  "name": "Wellness Studio",
                  "suite": "703",
                  "floor": "7",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-022",
                  "name": "Dining Commons",
                  "suite": "801",
                  "floor": "8",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-023",
                  "name": "Facilities & Logistics",
                  "suite": "802",
                  "floor": "8",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-024",
                  "name": "Travel Services",
                  "suite": "803",
                  "floor": "8",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-025",
                  "name": "Partner Relations",
                  "suite": "901",
                  "floor": "9",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-026",
                  "name": "Regional Operations",
                  "suite": "902",
                  "floor": "9",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-027",
                  "name": "Archives & Records",
                  "suite": "903",
                  "floor": "9",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-028",
                  "name": "Media Studio",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Marketing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-029",
                  "name": "Strategy & Planning",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Leadership",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-030",
                  "name": "Sustainability Office",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Elevator Stack — Portrait",
    "description": "Corporate directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#e9efec",
    "id": "preset-corporate-directory-elevator-stack-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/elevator-stack-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "elevator-stack",
            "orientation": "portrait",
            "dataset": {
              "title": "Northline Headquarters",
              "subtitle": "Workplace campus · Reception",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "corporate-001",
                  "name": "Reception & Visitor Services",
                  "suite": "101",
                  "floor": "1",
                  "category": "Guest services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-002",
                  "name": "People & Culture",
                  "suite": "102",
                  "floor": "1",
                  "category": "People",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-003",
                  "name": "Learning & Development",
                  "suite": "103",
                  "floor": "1",
                  "category": "People",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-004",
                  "name": "Workplace Experience",
                  "suite": "201",
                  "floor": "2",
                  "category": "People",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-005",
                  "name": "Brand & Communications",
                  "suite": "202",
                  "floor": "2",
                  "category": "Marketing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-006",
                  "name": "Customer Success",
                  "suite": "203",
                  "floor": "2",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-007",
                  "name": "Product Design",
                  "suite": "301",
                  "floor": "3",
                  "category": "Product",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-008",
                  "name": "Research & Insights",
                  "suite": "302",
                  "floor": "3",
                  "category": "Product",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-009",
                  "name": "Engineering Studio",
                  "suite": "303",
                  "floor": "3",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-010",
                  "name": "Cloud Operations",
                  "suite": "401",
                  "floor": "4",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-011",
                  "name": "Information Security",
                  "suite": "402",
                  "floor": "4",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-012",
                  "name": "Finance & Accounting",
                  "suite": "403",
                  "floor": "4",
                  "category": "Finance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-013",
                  "name": "Legal & Compliance",
                  "suite": "501",
                  "floor": "5",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-014",
                  "name": "Executive Office",
                  "suite": "502",
                  "floor": "5",
                  "category": "Leadership",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-015",
                  "name": "Boardroom North",
                  "suite": "503",
                  "floor": "5",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-016",
                  "name": "Boardroom South",
                  "suite": "601",
                  "floor": "6",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-017",
                  "name": "Orchard Meeting Rooms",
                  "suite": "602",
                  "floor": "6",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-018",
                  "name": "Cedar Collaboration Hub",
                  "suite": "603",
                  "floor": "6",
                  "category": "Meeting spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-019",
                  "name": "Innovation Lab",
                  "suite": "701",
                  "floor": "7",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-020",
                  "name": "Community Lounge",
                  "suite": "702",
                  "floor": "7",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-021",
                  "name": "Wellness Studio",
                  "suite": "703",
                  "floor": "7",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-022",
                  "name": "Dining Commons",
                  "suite": "801",
                  "floor": "8",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-023",
                  "name": "Facilities & Logistics",
                  "suite": "802",
                  "floor": "8",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-024",
                  "name": "Travel Services",
                  "suite": "803",
                  "floor": "8",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-025",
                  "name": "Partner Relations",
                  "suite": "901",
                  "floor": "9",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-026",
                  "name": "Regional Operations",
                  "suite": "902",
                  "floor": "9",
                  "category": "Operations",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-027",
                  "name": "Archives & Records",
                  "suite": "903",
                  "floor": "9",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-028",
                  "name": "Media Studio",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Marketing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-029",
                  "name": "Strategy & Planning",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Leadership",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "corporate-030",
                  "name": "Sustainability Office",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Departures Board",
    "description": "Industrial / logistics directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#17201e",
    "id": "preset-corporate-directory-departures-board-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/departures-board-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "departures-board",
            "orientation": "landscape",
            "dataset": {
              "title": "Port Nine Logistics",
              "subtitle": "Distribution campus · Gate A",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "industrial-001",
                  "name": "Inbound Receiving",
                  "suite": "B01",
                  "floor": "1",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-002",
                  "name": "Outbound Dispatch",
                  "suite": "B02",
                  "floor": "1",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-003",
                  "name": "Freight Coordination",
                  "suite": "B03",
                  "floor": "1",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-004",
                  "name": "Parcel Consolidation",
                  "suite": "B04",
                  "floor": "2",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-005",
                  "name": "Customs Documentation",
                  "suite": "B05",
                  "floor": "2",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-006",
                  "name": "Driver Check-in",
                  "suite": "B06",
                  "floor": "2",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-007",
                  "name": "Fleet Operations",
                  "suite": "B07",
                  "floor": "3",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-008",
                  "name": "Packaging Services",
                  "suite": "B08",
                  "floor": "3",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-009",
                  "name": "Warehouse Administration",
                  "suite": "B09",
                  "floor": "3",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-010",
                  "name": "Quality Assurance",
                  "suite": "B10",
                  "floor": "4",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-011",
                  "name": "Cold Chain Services",
                  "suite": "B11",
                  "floor": "4",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-012",
                  "name": "Returns Processing",
                  "suite": "B12",
                  "floor": "4",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-013",
                  "name": "Pallet Exchange",
                  "suite": "B13",
                  "floor": "5",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-014",
                  "name": "Cross-dock Operations",
                  "suite": "B14",
                  "floor": "5",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-015",
                  "name": "Equipment Maintenance",
                  "suite": "B15",
                  "floor": "5",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-016",
                  "name": "Safety Training",
                  "suite": "B16",
                  "floor": "6",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-017",
                  "name": "Procurement Office",
                  "suite": "B17",
                  "floor": "6",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-018",
                  "name": "Inventory Control",
                  "suite": "B18",
                  "floor": "6",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-019",
                  "name": "Carrier Relations",
                  "suite": "B19",
                  "floor": "7",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-020",
                  "name": "Vehicle Inspection",
                  "suite": "B20",
                  "floor": "7",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-021",
                  "name": "Bulk Storage",
                  "suite": "B21",
                  "floor": "7",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-022",
                  "name": "Export Documentation",
                  "suite": "B22",
                  "floor": "8",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-023",
                  "name": "Operations Planning",
                  "suite": "B23",
                  "floor": "8",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-024",
                  "name": "Site Management",
                  "suite": "B24",
                  "floor": "8",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-025",
                  "name": "Staff Facilities",
                  "suite": "B25",
                  "floor": "9",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-026",
                  "name": "Security Reception",
                  "suite": "B26",
                  "floor": "9",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-027",
                  "name": "Engineering Workshop",
                  "suite": "B27",
                  "floor": "9",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-028",
                  "name": "Battery Service",
                  "suite": "B28",
                  "floor": "10",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-029",
                  "name": "Order Fulfilment",
                  "suite": "B29",
                  "floor": "10",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-030",
                  "name": "Service Desk",
                  "suite": "B30",
                  "floor": "10",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Departures Board — Portrait",
    "description": "Industrial / logistics directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#17201e",
    "id": "preset-corporate-directory-departures-board-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/departures-board-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "departures-board",
            "orientation": "portrait",
            "dataset": {
              "title": "Port Nine Logistics",
              "subtitle": "Distribution campus · Gate A",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "industrial-001",
                  "name": "Inbound Receiving",
                  "suite": "B01",
                  "floor": "1",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-002",
                  "name": "Outbound Dispatch",
                  "suite": "B02",
                  "floor": "1",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-003",
                  "name": "Freight Coordination",
                  "suite": "B03",
                  "floor": "1",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-004",
                  "name": "Parcel Consolidation",
                  "suite": "B04",
                  "floor": "2",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-005",
                  "name": "Customs Documentation",
                  "suite": "B05",
                  "floor": "2",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-006",
                  "name": "Driver Check-in",
                  "suite": "B06",
                  "floor": "2",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-007",
                  "name": "Fleet Operations",
                  "suite": "B07",
                  "floor": "3",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-008",
                  "name": "Packaging Services",
                  "suite": "B08",
                  "floor": "3",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-009",
                  "name": "Warehouse Administration",
                  "suite": "B09",
                  "floor": "3",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-010",
                  "name": "Quality Assurance",
                  "suite": "B10",
                  "floor": "4",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-011",
                  "name": "Cold Chain Services",
                  "suite": "B11",
                  "floor": "4",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-012",
                  "name": "Returns Processing",
                  "suite": "B12",
                  "floor": "4",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-013",
                  "name": "Pallet Exchange",
                  "suite": "B13",
                  "floor": "5",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-014",
                  "name": "Cross-dock Operations",
                  "suite": "B14",
                  "floor": "5",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-015",
                  "name": "Equipment Maintenance",
                  "suite": "B15",
                  "floor": "5",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-016",
                  "name": "Safety Training",
                  "suite": "B16",
                  "floor": "6",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-017",
                  "name": "Procurement Office",
                  "suite": "B17",
                  "floor": "6",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-018",
                  "name": "Inventory Control",
                  "suite": "B18",
                  "floor": "6",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-019",
                  "name": "Carrier Relations",
                  "suite": "B19",
                  "floor": "7",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-020",
                  "name": "Vehicle Inspection",
                  "suite": "B20",
                  "floor": "7",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-021",
                  "name": "Bulk Storage",
                  "suite": "B21",
                  "floor": "7",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-022",
                  "name": "Export Documentation",
                  "suite": "B22",
                  "floor": "8",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-023",
                  "name": "Operations Planning",
                  "suite": "B23",
                  "floor": "8",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-024",
                  "name": "Site Management",
                  "suite": "B24",
                  "floor": "8",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-025",
                  "name": "Staff Facilities",
                  "suite": "B25",
                  "floor": "9",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-026",
                  "name": "Security Reception",
                  "suite": "B26",
                  "floor": "9",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-027",
                  "name": "Engineering Workshop",
                  "suite": "B27",
                  "floor": "9",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-028",
                  "name": "Battery Service",
                  "suite": "B28",
                  "floor": "10",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-029",
                  "name": "Order Fulfilment",
                  "suite": "B29",
                  "floor": "10",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "industrial-030",
                  "name": "Service Desk",
                  "suite": "B30",
                  "floor": "10",
                  "category": "Logistics",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Luxury Concierge",
    "description": "Hospitality directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#322830",
    "id": "preset-corporate-directory-luxury-concierge-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/luxury-concierge-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "luxury-concierge",
            "orientation": "landscape",
            "dataset": {
              "title": "The Halcyon Hotel",
              "subtitle": "A considered stay · Lobby",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "hospitality-001",
                  "name": "Arrival Lounge",
                  "suite": "101",
                  "floor": "1",
                  "category": "Arrival",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-002",
                  "name": "Guest Relations",
                  "suite": "102",
                  "floor": "1",
                  "category": "Arrival",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-003",
                  "name": "The Conservatory",
                  "suite": "103",
                  "floor": "1",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-004",
                  "name": "Juniper Restaurant",
                  "suite": "201",
                  "floor": "2",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-005",
                  "name": "Rooftop Observatory",
                  "suite": "202",
                  "floor": "2",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-006",
                  "name": "Stillwater Spa",
                  "suite": "203",
                  "floor": "2",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-007",
                  "name": "Movement Studio",
                  "suite": "301",
                  "floor": "3",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-008",
                  "name": "The Courtyard",
                  "suite": "302",
                  "floor": "3",
                  "category": "Leisure",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-009",
                  "name": "Pool Terrace",
                  "suite": "303",
                  "floor": "3",
                  "category": "Leisure",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-010",
                  "name": "Garden Library",
                  "suite": "401",
                  "floor": "4",
                  "category": "Leisure",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-011",
                  "name": "Grand Salon",
                  "suite": "402",
                  "floor": "4",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-012",
                  "name": "Atelier Ballroom",
                  "suite": "403",
                  "floor": "4",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-013",
                  "name": "North Meeting Suite",
                  "suite": "501",
                  "floor": "5",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-014",
                  "name": "South Meeting Suite",
                  "suite": "502",
                  "floor": "5",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-015",
                  "name": "Executive Lounge",
                  "suite": "503",
                  "floor": "5",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-016",
                  "name": "Harbour Suites",
                  "suite": "601",
                  "floor": "6",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-017",
                  "name": "Garden Suites",
                  "suite": "602",
                  "floor": "6",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-018",
                  "name": "Sky Residences",
                  "suite": "603",
                  "floor": "6",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-019",
                  "name": "Coastal Rooms",
                  "suite": "701",
                  "floor": "7",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-020",
                  "name": "Family Lounge",
                  "suite": "702",
                  "floor": "7",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-021",
                  "name": "Private Dining Room",
                  "suite": "703",
                  "floor": "7",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-022",
                  "name": "Gallery Boutique",
                  "suite": "801",
                  "floor": "8",
                  "category": "Shopping",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-023",
                  "name": "Florist Studio",
                  "suite": "802",
                  "floor": "8",
                  "category": "Shopping",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-024",
                  "name": "Business Lounge",
                  "suite": "803",
                  "floor": "8",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-025",
                  "name": "Valet Reception",
                  "suite": "901",
                  "floor": "9",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-026",
                  "name": "Luggage Services",
                  "suite": "902",
                  "floor": "9",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-027",
                  "name": "Concierge Office",
                  "suite": "903",
                  "floor": "9",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-028",
                  "name": "Guest Laundry",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-029",
                  "name": "Travel Studio",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-030",
                  "name": "Quiet Room",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Luxury Concierge — Portrait",
    "description": "Hospitality directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#322830",
    "id": "preset-corporate-directory-luxury-concierge-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/luxury-concierge-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "luxury-concierge",
            "orientation": "portrait",
            "dataset": {
              "title": "The Halcyon Hotel",
              "subtitle": "A considered stay · Lobby",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "hospitality-001",
                  "name": "Arrival Lounge",
                  "suite": "101",
                  "floor": "1",
                  "category": "Arrival",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-002",
                  "name": "Guest Relations",
                  "suite": "102",
                  "floor": "1",
                  "category": "Arrival",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-003",
                  "name": "The Conservatory",
                  "suite": "103",
                  "floor": "1",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-004",
                  "name": "Juniper Restaurant",
                  "suite": "201",
                  "floor": "2",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-005",
                  "name": "Rooftop Observatory",
                  "suite": "202",
                  "floor": "2",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-006",
                  "name": "Stillwater Spa",
                  "suite": "203",
                  "floor": "2",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-007",
                  "name": "Movement Studio",
                  "suite": "301",
                  "floor": "3",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-008",
                  "name": "The Courtyard",
                  "suite": "302",
                  "floor": "3",
                  "category": "Leisure",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-009",
                  "name": "Pool Terrace",
                  "suite": "303",
                  "floor": "3",
                  "category": "Leisure",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-010",
                  "name": "Garden Library",
                  "suite": "401",
                  "floor": "4",
                  "category": "Leisure",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-011",
                  "name": "Grand Salon",
                  "suite": "402",
                  "floor": "4",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-012",
                  "name": "Atelier Ballroom",
                  "suite": "403",
                  "floor": "4",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-013",
                  "name": "North Meeting Suite",
                  "suite": "501",
                  "floor": "5",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-014",
                  "name": "South Meeting Suite",
                  "suite": "502",
                  "floor": "5",
                  "category": "Events",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-015",
                  "name": "Executive Lounge",
                  "suite": "503",
                  "floor": "5",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-016",
                  "name": "Harbour Suites",
                  "suite": "601",
                  "floor": "6",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-017",
                  "name": "Garden Suites",
                  "suite": "602",
                  "floor": "6",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-018",
                  "name": "Sky Residences",
                  "suite": "603",
                  "floor": "6",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-019",
                  "name": "Coastal Rooms",
                  "suite": "701",
                  "floor": "7",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-020",
                  "name": "Family Lounge",
                  "suite": "702",
                  "floor": "7",
                  "category": "Guest spaces",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-021",
                  "name": "Private Dining Room",
                  "suite": "703",
                  "floor": "7",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-022",
                  "name": "Gallery Boutique",
                  "suite": "801",
                  "floor": "8",
                  "category": "Shopping",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-023",
                  "name": "Florist Studio",
                  "suite": "802",
                  "floor": "8",
                  "category": "Shopping",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-024",
                  "name": "Business Lounge",
                  "suite": "803",
                  "floor": "8",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-025",
                  "name": "Valet Reception",
                  "suite": "901",
                  "floor": "9",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-026",
                  "name": "Luggage Services",
                  "suite": "902",
                  "floor": "9",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-027",
                  "name": "Concierge Office",
                  "suite": "903",
                  "floor": "9",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-028",
                  "name": "Guest Laundry",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-029",
                  "name": "Travel Studio",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "hospitality-030",
                  "name": "Quiet Room",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Swiss Wayfinding",
    "description": "Government / civic directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#f5f2eb",
    "id": "preset-corporate-directory-swiss-wayfinding-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/swiss-wayfinding-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "swiss-wayfinding",
            "orientation": "landscape",
            "dataset": {
              "title": "Common Ground Civic Centre",
              "subtitle": "Community services · Public entrance",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "civic-001",
                  "name": "Business Licensing",
                  "suite": "101",
                  "floor": "1",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-002",
                  "name": "Building Applications",
                  "suite": "102",
                  "floor": "1",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-003",
                  "name": "Community Grants",
                  "suite": "103",
                  "floor": "1",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-004",
                  "name": "Council Chamber",
                  "suite": "201",
                  "floor": "2",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-005",
                  "name": "Cultural Affairs",
                  "suite": "202",
                  "floor": "2",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-006",
                  "name": "Customer Assistance",
                  "suite": "203",
                  "floor": "2",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-007",
                  "name": "Document Services",
                  "suite": "301",
                  "floor": "3",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-008",
                  "name": "Elections Office",
                  "suite": "302",
                  "floor": "3",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-009",
                  "name": "Family Resources",
                  "suite": "303",
                  "floor": "3",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-010",
                  "name": "Finance Counter",
                  "suite": "401",
                  "floor": "4",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-011",
                  "name": "Housing Assistance",
                  "suite": "402",
                  "floor": "4",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-012",
                  "name": "Information Desk",
                  "suite": "403",
                  "floor": "4",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-013",
                  "name": "Land Records",
                  "suite": "501",
                  "floor": "5",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-014",
                  "name": "Legal Resources",
                  "suite": "502",
                  "floor": "5",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-015",
                  "name": "Library Services",
                  "suite": "503",
                  "floor": "5",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-016",
                  "name": "Marriage & Civil Records",
                  "suite": "601",
                  "floor": "6",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-017",
                  "name": "Neighbourhood Services",
                  "suite": "602",
                  "floor": "6",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-018",
                  "name": "Parks & Recreation",
                  "suite": "603",
                  "floor": "6",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-019",
                  "name": "Planning Enquiries",
                  "suite": "701",
                  "floor": "7",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-020",
                  "name": "Public Records",
                  "suite": "702",
                  "floor": "7",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-021",
                  "name": "Rates & Revenue",
                  "suite": "703",
                  "floor": "7",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-022",
                  "name": "Resident Registration",
                  "suite": "801",
                  "floor": "8",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-023",
                  "name": "Small Business Support",
                  "suite": "802",
                  "floor": "8",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-024",
                  "name": "Social Support Services",
                  "suite": "803",
                  "floor": "8",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-025",
                  "name": "Transport Enquiries",
                  "suite": "901",
                  "floor": "9",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-026",
                  "name": "Visitor Reception",
                  "suite": "902",
                  "floor": "9",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-027",
                  "name": "Volunteer Centre",
                  "suite": "903",
                  "floor": "9",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-028",
                  "name": "Water Services",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-029",
                  "name": "Youth Programmes",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-030",
                  "name": "Zoning Counter",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Swiss Wayfinding — Portrait",
    "description": "Government / civic directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#f5f2eb",
    "id": "preset-corporate-directory-swiss-wayfinding-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/swiss-wayfinding-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "swiss-wayfinding",
            "orientation": "portrait",
            "dataset": {
              "title": "Common Ground Civic Centre",
              "subtitle": "Community services · Public entrance",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "civic-001",
                  "name": "Business Licensing",
                  "suite": "101",
                  "floor": "1",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-002",
                  "name": "Building Applications",
                  "suite": "102",
                  "floor": "1",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-003",
                  "name": "Community Grants",
                  "suite": "103",
                  "floor": "1",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-004",
                  "name": "Council Chamber",
                  "suite": "201",
                  "floor": "2",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-005",
                  "name": "Cultural Affairs",
                  "suite": "202",
                  "floor": "2",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-006",
                  "name": "Customer Assistance",
                  "suite": "203",
                  "floor": "2",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-007",
                  "name": "Document Services",
                  "suite": "301",
                  "floor": "3",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-008",
                  "name": "Elections Office",
                  "suite": "302",
                  "floor": "3",
                  "category": "Governance",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-009",
                  "name": "Family Resources",
                  "suite": "303",
                  "floor": "3",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-010",
                  "name": "Finance Counter",
                  "suite": "401",
                  "floor": "4",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-011",
                  "name": "Housing Assistance",
                  "suite": "402",
                  "floor": "4",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-012",
                  "name": "Information Desk",
                  "suite": "403",
                  "floor": "4",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-013",
                  "name": "Land Records",
                  "suite": "501",
                  "floor": "5",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-014",
                  "name": "Legal Resources",
                  "suite": "502",
                  "floor": "5",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-015",
                  "name": "Library Services",
                  "suite": "503",
                  "floor": "5",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-016",
                  "name": "Marriage & Civil Records",
                  "suite": "601",
                  "floor": "6",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-017",
                  "name": "Neighbourhood Services",
                  "suite": "602",
                  "floor": "6",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-018",
                  "name": "Parks & Recreation",
                  "suite": "603",
                  "floor": "6",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-019",
                  "name": "Planning Enquiries",
                  "suite": "701",
                  "floor": "7",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-020",
                  "name": "Public Records",
                  "suite": "702",
                  "floor": "7",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-021",
                  "name": "Rates & Revenue",
                  "suite": "703",
                  "floor": "7",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-022",
                  "name": "Resident Registration",
                  "suite": "801",
                  "floor": "8",
                  "category": "Records",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-023",
                  "name": "Small Business Support",
                  "suite": "802",
                  "floor": "8",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-024",
                  "name": "Social Support Services",
                  "suite": "803",
                  "floor": "8",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-025",
                  "name": "Transport Enquiries",
                  "suite": "901",
                  "floor": "9",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-026",
                  "name": "Visitor Reception",
                  "suite": "902",
                  "floor": "9",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-027",
                  "name": "Volunteer Centre",
                  "suite": "903",
                  "floor": "9",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-028",
                  "name": "Water Services",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Public services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-029",
                  "name": "Youth Programmes",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Community",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "civic-030",
                  "name": "Zoning Counter",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Permits",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Tropical Modernist",
    "description": "Retail / mixed-use directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#e9e6d7",
    "id": "preset-corporate-directory-tropical-modernist-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/tropical-modernist-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "tropical-modernist",
            "orientation": "landscape",
            "dataset": {
              "title": "Paloma Quarter",
              "subtitle": "Shops · Studios · Good company",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "retail-001",
                  "name": "Acorn Market",
                  "suite": "101",
                  "floor": "1",
                  "category": "Provisions",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-002",
                  "name": "Alto Coffee Works",
                  "suite": "102",
                  "floor": "1",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-003",
                  "name": "April Flower House",
                  "suite": "103",
                  "floor": "1",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-004",
                  "name": "Basin Bath Studio",
                  "suite": "201",
                  "floor": "2",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-005",
                  "name": "Clay & Company",
                  "suite": "202",
                  "floor": "2",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-006",
                  "name": "Daybreak Bakery",
                  "suite": "203",
                  "floor": "2",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-007",
                  "name": "Elsewhere Books",
                  "suite": "301",
                  "floor": "3",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-008",
                  "name": "Fern & Frame",
                  "suite": "302",
                  "floor": "3",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-009",
                  "name": "Fika Table",
                  "suite": "303",
                  "floor": "3",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-010",
                  "name": "Gather Goods",
                  "suite": "401",
                  "floor": "4",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-011",
                  "name": "Good Form Fitness",
                  "suite": "402",
                  "floor": "4",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-012",
                  "name": "Haven Skin Studio",
                  "suite": "403",
                  "floor": "4",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-013",
                  "name": "Indigo Objects",
                  "suite": "501",
                  "floor": "5",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-014",
                  "name": "Junebug Kids",
                  "suite": "502",
                  "floor": "5",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-015",
                  "name": "Kindred Apparel",
                  "suite": "503",
                  "floor": "5",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-016",
                  "name": "Loam Plant Shop",
                  "suite": "601",
                  "floor": "6",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-017",
                  "name": "Morrow Optics",
                  "suite": "602",
                  "floor": "6",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-018",
                  "name": "Nook Paper Studio",
                  "suite": "603",
                  "floor": "6",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-019",
                  "name": "Olive & Salt",
                  "suite": "701",
                  "floor": "7",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-020",
                  "name": "Palisade Tailoring",
                  "suite": "702",
                  "floor": "7",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-021",
                  "name": "Quiet Hours Tea",
                  "suite": "703",
                  "floor": "7",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-022",
                  "name": "Reed Jewellery",
                  "suite": "801",
                  "floor": "8",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-023",
                  "name": "Sunday General",
                  "suite": "802",
                  "floor": "8",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-024",
                  "name": "Terra Ceramics",
                  "suite": "803",
                  "floor": "8",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-025",
                  "name": "Umber Leather",
                  "suite": "901",
                  "floor": "9",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-026",
                  "name": "Vale Wellness",
                  "suite": "902",
                  "floor": "9",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-027",
                  "name": "Woven House",
                  "suite": "903",
                  "floor": "9",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-028",
                  "name": "Yellow Finch Florist",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-029",
                  "name": "Zest Kitchen",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-030",
                  "name": "The Little Gallery",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Tropical Modernist — Portrait",
    "description": "Retail / mixed-use directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#e9e6d7",
    "id": "preset-corporate-directory-tropical-modernist-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/tropical-modernist-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "tropical-modernist",
            "orientation": "portrait",
            "dataset": {
              "title": "Paloma Quarter",
              "subtitle": "Shops · Studios · Good company",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "retail-001",
                  "name": "Acorn Market",
                  "suite": "101",
                  "floor": "1",
                  "category": "Provisions",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-002",
                  "name": "Alto Coffee Works",
                  "suite": "102",
                  "floor": "1",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-003",
                  "name": "April Flower House",
                  "suite": "103",
                  "floor": "1",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-004",
                  "name": "Basin Bath Studio",
                  "suite": "201",
                  "floor": "2",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-005",
                  "name": "Clay & Company",
                  "suite": "202",
                  "floor": "2",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-006",
                  "name": "Daybreak Bakery",
                  "suite": "203",
                  "floor": "2",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-007",
                  "name": "Elsewhere Books",
                  "suite": "301",
                  "floor": "3",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-008",
                  "name": "Fern & Frame",
                  "suite": "302",
                  "floor": "3",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-009",
                  "name": "Fika Table",
                  "suite": "303",
                  "floor": "3",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-010",
                  "name": "Gather Goods",
                  "suite": "401",
                  "floor": "4",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-011",
                  "name": "Good Form Fitness",
                  "suite": "402",
                  "floor": "4",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-012",
                  "name": "Haven Skin Studio",
                  "suite": "403",
                  "floor": "4",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-013",
                  "name": "Indigo Objects",
                  "suite": "501",
                  "floor": "5",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-014",
                  "name": "Junebug Kids",
                  "suite": "502",
                  "floor": "5",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-015",
                  "name": "Kindred Apparel",
                  "suite": "503",
                  "floor": "5",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-016",
                  "name": "Loam Plant Shop",
                  "suite": "601",
                  "floor": "6",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-017",
                  "name": "Morrow Optics",
                  "suite": "602",
                  "floor": "6",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-018",
                  "name": "Nook Paper Studio",
                  "suite": "603",
                  "floor": "6",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-019",
                  "name": "Olive & Salt",
                  "suite": "701",
                  "floor": "7",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-020",
                  "name": "Palisade Tailoring",
                  "suite": "702",
                  "floor": "7",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-021",
                  "name": "Quiet Hours Tea",
                  "suite": "703",
                  "floor": "7",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-022",
                  "name": "Reed Jewellery",
                  "suite": "801",
                  "floor": "8",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-023",
                  "name": "Sunday General",
                  "suite": "802",
                  "floor": "8",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-024",
                  "name": "Terra Ceramics",
                  "suite": "803",
                  "floor": "8",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-025",
                  "name": "Umber Leather",
                  "suite": "901",
                  "floor": "9",
                  "category": "Fashion",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-026",
                  "name": "Vale Wellness",
                  "suite": "902",
                  "floor": "9",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-027",
                  "name": "Woven House",
                  "suite": "903",
                  "floor": "9",
                  "category": "Home",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-028",
                  "name": "Yellow Finch Florist",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-029",
                  "name": "Zest Kitchen",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Dining",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "retail-030",
                  "name": "The Little Gallery",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Lifestyle",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Glass Facade",
    "description": "Creative / tech directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#123cad",
    "id": "preset-corporate-directory-glass-facade-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/glass-facade-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "glass-facade",
            "orientation": "landscape",
            "dataset": {
              "title": "FORM / WORK",
              "subtitle": "Studios for people with ideas",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "creative-001",
                  "name": "Afterimage Studio",
                  "suite": "101",
                  "floor": "1",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-002",
                  "name": "Analog Futures",
                  "suite": "102",
                  "floor": "1",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-003",
                  "name": "Arcform Labs",
                  "suite": "103",
                  "floor": "1",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-004",
                  "name": "Assembly Motion",
                  "suite": "201",
                  "floor": "2",
                  "category": "Film",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-005",
                  "name": "Brightmatter",
                  "suite": "202",
                  "floor": "2",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-006",
                  "name": "Canvas People",
                  "suite": "203",
                  "floor": "2",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-007",
                  "name": "Common Signal",
                  "suite": "301",
                  "floor": "3",
                  "category": "Strategy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-008",
                  "name": "Daylight Audio",
                  "suite": "302",
                  "floor": "3",
                  "category": "Sound",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-009",
                  "name": "Echo Pattern",
                  "suite": "303",
                  "floor": "3",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-010",
                  "name": "Folded Space",
                  "suite": "401",
                  "floor": "4",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-011",
                  "name": "Good Measure",
                  "suite": "402",
                  "floor": "4",
                  "category": "Strategy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-012",
                  "name": "Hatch Systems",
                  "suite": "403",
                  "floor": "4",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-013",
                  "name": "Interlude Films",
                  "suite": "501",
                  "floor": "5",
                  "category": "Film",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-014",
                  "name": "Junction Type",
                  "suite": "502",
                  "floor": "5",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-015",
                  "name": "Kind Circuit",
                  "suite": "503",
                  "floor": "5",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-016",
                  "name": "Lateral Office",
                  "suite": "601",
                  "floor": "6",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-017",
                  "name": "Mosaic Machine",
                  "suite": "602",
                  "floor": "6",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-018",
                  "name": "New Normal Studio",
                  "suite": "603",
                  "floor": "6",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-019",
                  "name": "Open Field Lab",
                  "suite": "701",
                  "floor": "7",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-020",
                  "name": "Paperplane Digital",
                  "suite": "702",
                  "floor": "7",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-021",
                  "name": "Quiet Signal",
                  "suite": "703",
                  "floor": "7",
                  "category": "Sound",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-022",
                  "name": "Remainder Studio",
                  "suite": "801",
                  "floor": "8",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-023",
                  "name": "Shape Society",
                  "suite": "802",
                  "floor": "8",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-024",
                  "name": "Tomorrow Works",
                  "suite": "803",
                  "floor": "8",
                  "category": "Strategy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-025",
                  "name": "Unfold Interactive",
                  "suite": "901",
                  "floor": "9",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-026",
                  "name": "Volume Studio",
                  "suite": "902",
                  "floor": "9",
                  "category": "Sound",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-027",
                  "name": "Wide Angle Office",
                  "suite": "903",
                  "floor": "9",
                  "category": "Film",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-028",
                  "name": "Xeno Materials",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-029",
                  "name": "Young Orbit",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-030",
                  "name": "Zero One Collective",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Glass Facade — Portrait",
    "description": "Creative / tech directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#123cad",
    "id": "preset-corporate-directory-glass-facade-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/glass-facade-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "glass-facade",
            "orientation": "portrait",
            "dataset": {
              "title": "FORM / WORK",
              "subtitle": "Studios for people with ideas",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "creative-001",
                  "name": "Afterimage Studio",
                  "suite": "101",
                  "floor": "1",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-002",
                  "name": "Analog Futures",
                  "suite": "102",
                  "floor": "1",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-003",
                  "name": "Arcform Labs",
                  "suite": "103",
                  "floor": "1",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-004",
                  "name": "Assembly Motion",
                  "suite": "201",
                  "floor": "2",
                  "category": "Film",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-005",
                  "name": "Brightmatter",
                  "suite": "202",
                  "floor": "2",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-006",
                  "name": "Canvas People",
                  "suite": "203",
                  "floor": "2",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-007",
                  "name": "Common Signal",
                  "suite": "301",
                  "floor": "3",
                  "category": "Strategy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-008",
                  "name": "Daylight Audio",
                  "suite": "302",
                  "floor": "3",
                  "category": "Sound",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-009",
                  "name": "Echo Pattern",
                  "suite": "303",
                  "floor": "3",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-010",
                  "name": "Folded Space",
                  "suite": "401",
                  "floor": "4",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-011",
                  "name": "Good Measure",
                  "suite": "402",
                  "floor": "4",
                  "category": "Strategy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-012",
                  "name": "Hatch Systems",
                  "suite": "403",
                  "floor": "4",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-013",
                  "name": "Interlude Films",
                  "suite": "501",
                  "floor": "5",
                  "category": "Film",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-014",
                  "name": "Junction Type",
                  "suite": "502",
                  "floor": "5",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-015",
                  "name": "Kind Circuit",
                  "suite": "503",
                  "floor": "5",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-016",
                  "name": "Lateral Office",
                  "suite": "601",
                  "floor": "6",
                  "category": "Architecture",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-017",
                  "name": "Mosaic Machine",
                  "suite": "602",
                  "floor": "6",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-018",
                  "name": "New Normal Studio",
                  "suite": "603",
                  "floor": "6",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-019",
                  "name": "Open Field Lab",
                  "suite": "701",
                  "floor": "7",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-020",
                  "name": "Paperplane Digital",
                  "suite": "702",
                  "floor": "7",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-021",
                  "name": "Quiet Signal",
                  "suite": "703",
                  "floor": "7",
                  "category": "Sound",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-022",
                  "name": "Remainder Studio",
                  "suite": "801",
                  "floor": "8",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-023",
                  "name": "Shape Society",
                  "suite": "802",
                  "floor": "8",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-024",
                  "name": "Tomorrow Works",
                  "suite": "803",
                  "floor": "8",
                  "category": "Strategy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-025",
                  "name": "Unfold Interactive",
                  "suite": "901",
                  "floor": "9",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-026",
                  "name": "Volume Studio",
                  "suite": "902",
                  "floor": "9",
                  "category": "Sound",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-027",
                  "name": "Wide Angle Office",
                  "suite": "903",
                  "floor": "9",
                  "category": "Film",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-028",
                  "name": "Xeno Materials",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Research",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-029",
                  "name": "Young Orbit",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Design",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "creative-030",
                  "name": "Zero One Collective",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Technology",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Brutalist Poster",
    "description": "Education / campus directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#e6ef66",
    "id": "preset-corporate-directory-brutalist-poster-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/brutalist-poster-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "brutalist-poster",
            "orientation": "landscape",
            "dataset": {
              "title": "Fieldwork University",
              "subtitle": "North campus · Learning without limits",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "education-001",
                  "name": "Admissions & Enrolment",
                  "suite": "101",
                  "floor": "1",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-002",
                  "name": "Academic Advising",
                  "suite": "102",
                  "floor": "1",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-003",
                  "name": "Accessibility Services",
                  "suite": "103",
                  "floor": "1",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-004",
                  "name": "Arts Workshop",
                  "suite": "201",
                  "floor": "2",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-005",
                  "name": "Architecture Studio",
                  "suite": "202",
                  "floor": "2",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-006",
                  "name": "Animation Lab",
                  "suite": "203",
                  "floor": "2",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-007",
                  "name": "Biology Research",
                  "suite": "301",
                  "floor": "3",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-008",
                  "name": "Chemistry Laboratories",
                  "suite": "302",
                  "floor": "3",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-009",
                  "name": "Computing Centre",
                  "suite": "303",
                  "floor": "3",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-010",
                  "name": "Design Library",
                  "suite": "401",
                  "floor": "4",
                  "category": "Library",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-011",
                  "name": "Digital Scholarship",
                  "suite": "402",
                  "floor": "4",
                  "category": "Library",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-012",
                  "name": "Engineering Workshop",
                  "suite": "403",
                  "floor": "4",
                  "category": "Engineering",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-013",
                  "name": "Energy Systems Lab",
                  "suite": "501",
                  "floor": "5",
                  "category": "Engineering",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-014",
                  "name": "Faculty Offices",
                  "suite": "502",
                  "floor": "5",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-015",
                  "name": "Graduate Studies",
                  "suite": "503",
                  "floor": "5",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-016",
                  "name": "Global Programmes",
                  "suite": "601",
                  "floor": "6",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-017",
                  "name": "History Department",
                  "suite": "602",
                  "floor": "6",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-018",
                  "name": "Innovation Commons",
                  "suite": "603",
                  "floor": "6",
                  "category": "Engineering",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-019",
                  "name": "Languages Centre",
                  "suite": "701",
                  "floor": "7",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-020",
                  "name": "Learning Support",
                  "suite": "702",
                  "floor": "7",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-021",
                  "name": "Media Production",
                  "suite": "703",
                  "floor": "7",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-022",
                  "name": "Mathematics Centre",
                  "suite": "801",
                  "floor": "8",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-023",
                  "name": "Performing Arts Hall",
                  "suite": "802",
                  "floor": "8",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-024",
                  "name": "Philosophy Department",
                  "suite": "803",
                  "floor": "8",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-025",
                  "name": "Registrar Office",
                  "suite": "901",
                  "floor": "9",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-026",
                  "name": "Research Services",
                  "suite": "902",
                  "floor": "9",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-027",
                  "name": "Student Union",
                  "suite": "903",
                  "floor": "9",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-028",
                  "name": "Teaching Resources",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Library",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-029",
                  "name": "Urban Studies",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-030",
                  "name": "Writing Centre",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Brutalist Poster — Portrait",
    "description": "Education / campus directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#e6ef66",
    "id": "preset-corporate-directory-brutalist-poster-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/brutalist-poster-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "brutalist-poster",
            "orientation": "portrait",
            "dataset": {
              "title": "Fieldwork University",
              "subtitle": "North campus · Learning without limits",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "education-001",
                  "name": "Admissions & Enrolment",
                  "suite": "101",
                  "floor": "1",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-002",
                  "name": "Academic Advising",
                  "suite": "102",
                  "floor": "1",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-003",
                  "name": "Accessibility Services",
                  "suite": "103",
                  "floor": "1",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-004",
                  "name": "Arts Workshop",
                  "suite": "201",
                  "floor": "2",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-005",
                  "name": "Architecture Studio",
                  "suite": "202",
                  "floor": "2",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-006",
                  "name": "Animation Lab",
                  "suite": "203",
                  "floor": "2",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-007",
                  "name": "Biology Research",
                  "suite": "301",
                  "floor": "3",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-008",
                  "name": "Chemistry Laboratories",
                  "suite": "302",
                  "floor": "3",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-009",
                  "name": "Computing Centre",
                  "suite": "303",
                  "floor": "3",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-010",
                  "name": "Design Library",
                  "suite": "401",
                  "floor": "4",
                  "category": "Library",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-011",
                  "name": "Digital Scholarship",
                  "suite": "402",
                  "floor": "4",
                  "category": "Library",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-012",
                  "name": "Engineering Workshop",
                  "suite": "403",
                  "floor": "4",
                  "category": "Engineering",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-013",
                  "name": "Energy Systems Lab",
                  "suite": "501",
                  "floor": "5",
                  "category": "Engineering",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-014",
                  "name": "Faculty Offices",
                  "suite": "502",
                  "floor": "5",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-015",
                  "name": "Graduate Studies",
                  "suite": "503",
                  "floor": "5",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-016",
                  "name": "Global Programmes",
                  "suite": "601",
                  "floor": "6",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-017",
                  "name": "History Department",
                  "suite": "602",
                  "floor": "6",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-018",
                  "name": "Innovation Commons",
                  "suite": "603",
                  "floor": "6",
                  "category": "Engineering",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-019",
                  "name": "Languages Centre",
                  "suite": "701",
                  "floor": "7",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-020",
                  "name": "Learning Support",
                  "suite": "702",
                  "floor": "7",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-021",
                  "name": "Media Production",
                  "suite": "703",
                  "floor": "7",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-022",
                  "name": "Mathematics Centre",
                  "suite": "801",
                  "floor": "8",
                  "category": "Sciences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-023",
                  "name": "Performing Arts Hall",
                  "suite": "802",
                  "floor": "8",
                  "category": "Arts",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-024",
                  "name": "Philosophy Department",
                  "suite": "803",
                  "floor": "8",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-025",
                  "name": "Registrar Office",
                  "suite": "901",
                  "floor": "9",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-026",
                  "name": "Research Services",
                  "suite": "902",
                  "floor": "9",
                  "category": "Administration",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-027",
                  "name": "Student Union",
                  "suite": "903",
                  "floor": "9",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-028",
                  "name": "Teaching Resources",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Library",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-029",
                  "name": "Urban Studies",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Humanities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "education-030",
                  "name": "Writing Centre",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Student services",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Care Atlas",
    "description": "Medical / wellness directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#edf3f0",
    "id": "preset-corporate-directory-care-atlas-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/care-atlas-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "care-atlas",
            "orientation": "landscape",
            "dataset": {
              "title": "Stillpoint Medical Centre",
              "subtitle": "Specialist care · Main reception",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "medical-001",
                  "name": "Alder Family Practice",
                  "suite": "101",
                  "floor": "1",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-002",
                  "name": "Clearview Eye Clinic",
                  "suite": "102",
                  "floor": "1",
                  "category": "Vision",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-003",
                  "name": "Clover Paediatrics",
                  "suite": "103",
                  "floor": "1",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-004",
                  "name": "Elm Dermatology",
                  "suite": "201",
                  "floor": "2",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-005",
                  "name": "Everwell Cardiology",
                  "suite": "202",
                  "floor": "2",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-006",
                  "name": "Fern Women’s Health",
                  "suite": "203",
                  "floor": "2",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-007",
                  "name": "Goodwell Dental",
                  "suite": "301",
                  "floor": "3",
                  "category": "Dental",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-008",
                  "name": "Harbour Imaging",
                  "suite": "302",
                  "floor": "3",
                  "category": "Diagnostics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-009",
                  "name": "Hearth Physical Therapy",
                  "suite": "303",
                  "floor": "3",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-010",
                  "name": "Juniper Orthopaedics",
                  "suite": "401",
                  "floor": "4",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-011",
                  "name": "Kindred Speech Clinic",
                  "suite": "402",
                  "floor": "4",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-012",
                  "name": "Linden Hearing Centre",
                  "suite": "403",
                  "floor": "4",
                  "category": "Hearing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-013",
                  "name": "Meadow Counselling",
                  "suite": "501",
                  "floor": "5",
                  "category": "Behavioural health",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-014",
                  "name": "Northstar Neurology",
                  "suite": "502",
                  "floor": "5",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-015",
                  "name": "Oakleaf Pharmacy",
                  "suite": "503",
                  "floor": "5",
                  "category": "Pharmacy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-016",
                  "name": "Orchard Endocrinology",
                  "suite": "601",
                  "floor": "6",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-017",
                  "name": "Pinecrest Primary Care",
                  "suite": "602",
                  "floor": "6",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-018",
                  "name": "Quietwater Psychology",
                  "suite": "603",
                  "floor": "6",
                  "category": "Behavioural health",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-019",
                  "name": "Riverbend Laboratory",
                  "suite": "701",
                  "floor": "7",
                  "category": "Diagnostics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-020",
                  "name": "Shoreline Nutrition",
                  "suite": "702",
                  "floor": "7",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-021",
                  "name": "Stillwater Audiology",
                  "suite": "703",
                  "floor": "7",
                  "category": "Hearing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-022",
                  "name": "Summit Sports Medicine",
                  "suite": "801",
                  "floor": "8",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-023",
                  "name": "Terrace Dental Arts",
                  "suite": "802",
                  "floor": "8",
                  "category": "Dental",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-024",
                  "name": "Union Diagnostics",
                  "suite": "803",
                  "floor": "8",
                  "category": "Diagnostics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-025",
                  "name": "Vale Podiatry",
                  "suite": "901",
                  "floor": "9",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-026",
                  "name": "Willow Occupational Therapy",
                  "suite": "902",
                  "floor": "9",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-027",
                  "name": "Woodland Wellness",
                  "suite": "903",
                  "floor": "9",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-028",
                  "name": "Youthwell Clinic",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-029",
                  "name": "Zephyr Sleep Centre",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-030",
                  "name": "Patient Services",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Reception",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Care Atlas — Portrait",
    "description": "Medical / wellness directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#edf3f0",
    "id": "preset-corporate-directory-care-atlas-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/care-atlas-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "care-atlas",
            "orientation": "portrait",
            "dataset": {
              "title": "Stillpoint Medical Centre",
              "subtitle": "Specialist care · Main reception",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "medical-001",
                  "name": "Alder Family Practice",
                  "suite": "101",
                  "floor": "1",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-002",
                  "name": "Clearview Eye Clinic",
                  "suite": "102",
                  "floor": "1",
                  "category": "Vision",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-003",
                  "name": "Clover Paediatrics",
                  "suite": "103",
                  "floor": "1",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-004",
                  "name": "Elm Dermatology",
                  "suite": "201",
                  "floor": "2",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-005",
                  "name": "Everwell Cardiology",
                  "suite": "202",
                  "floor": "2",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-006",
                  "name": "Fern Women’s Health",
                  "suite": "203",
                  "floor": "2",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-007",
                  "name": "Goodwell Dental",
                  "suite": "301",
                  "floor": "3",
                  "category": "Dental",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-008",
                  "name": "Harbour Imaging",
                  "suite": "302",
                  "floor": "3",
                  "category": "Diagnostics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-009",
                  "name": "Hearth Physical Therapy",
                  "suite": "303",
                  "floor": "3",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-010",
                  "name": "Juniper Orthopaedics",
                  "suite": "401",
                  "floor": "4",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-011",
                  "name": "Kindred Speech Clinic",
                  "suite": "402",
                  "floor": "4",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-012",
                  "name": "Linden Hearing Centre",
                  "suite": "403",
                  "floor": "4",
                  "category": "Hearing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-013",
                  "name": "Meadow Counselling",
                  "suite": "501",
                  "floor": "5",
                  "category": "Behavioural health",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-014",
                  "name": "Northstar Neurology",
                  "suite": "502",
                  "floor": "5",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-015",
                  "name": "Oakleaf Pharmacy",
                  "suite": "503",
                  "floor": "5",
                  "category": "Pharmacy",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-016",
                  "name": "Orchard Endocrinology",
                  "suite": "601",
                  "floor": "6",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-017",
                  "name": "Pinecrest Primary Care",
                  "suite": "602",
                  "floor": "6",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-018",
                  "name": "Quietwater Psychology",
                  "suite": "603",
                  "floor": "6",
                  "category": "Behavioural health",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-019",
                  "name": "Riverbend Laboratory",
                  "suite": "701",
                  "floor": "7",
                  "category": "Diagnostics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-020",
                  "name": "Shoreline Nutrition",
                  "suite": "702",
                  "floor": "7",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-021",
                  "name": "Stillwater Audiology",
                  "suite": "703",
                  "floor": "7",
                  "category": "Hearing",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-022",
                  "name": "Summit Sports Medicine",
                  "suite": "801",
                  "floor": "8",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-023",
                  "name": "Terrace Dental Arts",
                  "suite": "802",
                  "floor": "8",
                  "category": "Dental",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-024",
                  "name": "Union Diagnostics",
                  "suite": "803",
                  "floor": "8",
                  "category": "Diagnostics",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-025",
                  "name": "Vale Podiatry",
                  "suite": "901",
                  "floor": "9",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-026",
                  "name": "Willow Occupational Therapy",
                  "suite": "902",
                  "floor": "9",
                  "category": "Rehabilitation",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-027",
                  "name": "Woodland Wellness",
                  "suite": "903",
                  "floor": "9",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-028",
                  "name": "Youthwell Clinic",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Primary care",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-029",
                  "name": "Zephyr Sleep Centre",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Specialists",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "medical-030",
                  "name": "Patient Services",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Reception",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Maison Residence",
    "description": "Luxury / residential directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#eae0d1",
    "id": "preset-corporate-directory-maison-residence-landscape",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/maison-residence-landscape.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "maison-residence",
            "orientation": "landscape",
            "dataset": {
              "title": "Maison Aurelia",
              "subtitle": "Residences · Private arrival",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "residential-001",
                  "name": "Arrival Salon",
                  "suite": "101",
                  "floor": "1",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-002",
                  "name": "Resident Concierge",
                  "suite": "102",
                  "floor": "1",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-003",
                  "name": "Parcel Atelier",
                  "suite": "103",
                  "floor": "1",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-004",
                  "name": "Estate Management",
                  "suite": "201",
                  "floor": "2",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-005",
                  "name": "Garden Residences",
                  "suite": "202",
                  "floor": "2",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-006",
                  "name": "Courtyard Residences",
                  "suite": "203",
                  "floor": "2",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-007",
                  "name": "Terrace Residences",
                  "suite": "301",
                  "floor": "3",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-008",
                  "name": "Panorama Residences",
                  "suite": "302",
                  "floor": "3",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-009",
                  "name": "Sky Residences",
                  "suite": "303",
                  "floor": "3",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-010",
                  "name": "Penthouse Collection",
                  "suite": "401",
                  "floor": "4",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-011",
                  "name": "Library Salon",
                  "suite": "402",
                  "floor": "4",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-012",
                  "name": "Drawing Room",
                  "suite": "403",
                  "floor": "4",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-013",
                  "name": "Private Dining Suite",
                  "suite": "501",
                  "floor": "5",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-014",
                  "name": "Chef’s Kitchen",
                  "suite": "502",
                  "floor": "5",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-015",
                  "name": "Wellness Pavilion",
                  "suite": "503",
                  "floor": "5",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-016",
                  "name": "Movement Atelier",
                  "suite": "601",
                  "floor": "6",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-017",
                  "name": "Treatment Rooms",
                  "suite": "602",
                  "floor": "6",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-018",
                  "name": "Quiet Garden",
                  "suite": "603",
                  "floor": "6",
                  "category": "Gardens",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-019",
                  "name": "Winter Garden",
                  "suite": "701",
                  "floor": "7",
                  "category": "Gardens",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-020",
                  "name": "Pool House",
                  "suite": "702",
                  "floor": "7",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-021",
                  "name": "Screening Room",
                  "suite": "703",
                  "floor": "7",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-022",
                  "name": "Music Salon",
                  "suite": "801",
                  "floor": "8",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-023",
                  "name": "Children’s Studio",
                  "suite": "802",
                  "floor": "8",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-024",
                  "name": "Guest Residence",
                  "suite": "803",
                  "floor": "8",
                  "category": "Guest services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-025",
                  "name": "Business Salon",
                  "suite": "901",
                  "floor": "9",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-026",
                  "name": "Valet Lounge",
                  "suite": "902",
                  "floor": "9",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-027",
                  "name": "Cycle Studio",
                  "suite": "903",
                  "floor": "9",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-028",
                  "name": "Pet Care Studio",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-029",
                  "name": "Roof Garden",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Gardens",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-030",
                  "name": "Residents’ Club",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  },
  {
    "name": "Corporate · Directory · Maison Residence — Portrait",
    "description": "Luxury / residential directory. Editable destinations, automatic and manual pages, configurable rotation.",
    "category": "LOBBY",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#eae0d1",
    "id": "preset-corporate-directory-maison-residence-portrait",
    "schoolLevel": "UNIVERSAL",
    "zones": [
      {
        "name": "Directory",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/directory/maison-residence-portrait.html",
          "directoryDocument": {
            "format": "arc-riot.directory",
            "version": 1,
            "designId": "maison-residence",
            "orientation": "portrait",
            "dataset": {
              "title": "Maison Aurelia",
              "subtitle": "Residences · Private arrival",
              "locationLabel": "Main lobby",
              "footer": "Find your destination",
              "image": null,
              "fictional": true,
              "tenants": [
                {
                  "id": "residential-001",
                  "name": "Arrival Salon",
                  "suite": "101",
                  "floor": "1",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-002",
                  "name": "Resident Concierge",
                  "suite": "102",
                  "floor": "1",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-003",
                  "name": "Parcel Atelier",
                  "suite": "103",
                  "floor": "1",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-004",
                  "name": "Estate Management",
                  "suite": "201",
                  "floor": "2",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-005",
                  "name": "Garden Residences",
                  "suite": "202",
                  "floor": "2",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-006",
                  "name": "Courtyard Residences",
                  "suite": "203",
                  "floor": "2",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-007",
                  "name": "Terrace Residences",
                  "suite": "301",
                  "floor": "3",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-008",
                  "name": "Panorama Residences",
                  "suite": "302",
                  "floor": "3",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-009",
                  "name": "Sky Residences",
                  "suite": "303",
                  "floor": "3",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-010",
                  "name": "Penthouse Collection",
                  "suite": "401",
                  "floor": "4",
                  "category": "Residences",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-011",
                  "name": "Library Salon",
                  "suite": "402",
                  "floor": "4",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-012",
                  "name": "Drawing Room",
                  "suite": "403",
                  "floor": "4",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-013",
                  "name": "Private Dining Suite",
                  "suite": "501",
                  "floor": "5",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-014",
                  "name": "Chef’s Kitchen",
                  "suite": "502",
                  "floor": "5",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-015",
                  "name": "Wellness Pavilion",
                  "suite": "503",
                  "floor": "5",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-016",
                  "name": "Movement Atelier",
                  "suite": "601",
                  "floor": "6",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-017",
                  "name": "Treatment Rooms",
                  "suite": "602",
                  "floor": "6",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-018",
                  "name": "Quiet Garden",
                  "suite": "603",
                  "floor": "6",
                  "category": "Gardens",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-019",
                  "name": "Winter Garden",
                  "suite": "701",
                  "floor": "7",
                  "category": "Gardens",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-020",
                  "name": "Pool House",
                  "suite": "702",
                  "floor": "7",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-021",
                  "name": "Screening Room",
                  "suite": "703",
                  "floor": "7",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-022",
                  "name": "Music Salon",
                  "suite": "801",
                  "floor": "8",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-023",
                  "name": "Children’s Studio",
                  "suite": "802",
                  "floor": "8",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-024",
                  "name": "Guest Residence",
                  "suite": "803",
                  "floor": "8",
                  "category": "Guest services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-025",
                  "name": "Business Salon",
                  "suite": "901",
                  "floor": "9",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-026",
                  "name": "Valet Lounge",
                  "suite": "902",
                  "floor": "9",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-027",
                  "name": "Cycle Studio",
                  "suite": "903",
                  "floor": "9",
                  "category": "Wellness",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-028",
                  "name": "Pet Care Studio",
                  "suite": "1001",
                  "floor": "10",
                  "category": "Resident services",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-029",
                  "name": "Roof Garden",
                  "suite": "1002",
                  "floor": "10",
                  "category": "Gardens",
                  "direction": "",
                  "active": true
                },
                {
                  "id": "residential-030",
                  "name": "Residents’ Club",
                  "suite": "1003",
                  "floor": "10",
                  "category": "Amenities",
                  "direction": "",
                  "active": true
                }
              ]
            },
            "playback": {
              "version": 1,
              "dataset": "demo",
              "design": "pacific-editorial",
              "orientation": "landscape",
              "autoplay": true,
              "pageDurationMs": 14000,
              "pageDurationsMs": [],
              "transitionMode": "crossfade",
              "transitionDurationMs": 900,
              "scrollSpeedPxPerSecond": 44,
              "scrollStartHoldMs": 2500,
              "sort": "design",
              "paused": false
            },
            "theme": {}
          }
        }
      }
    ]
  }
];
