import type { SystemPreset } from './system-presets';
export const TOUCH_PROPERTY_TEMPLATE_PRESETS: SystemPreset[] = [
  {
    "id": "preset-corporate-touch-harbor-cinema-landscape",
    "name": "Corporate · Commercial Real Estate · Harbor Cinema",
    "description": "An immersive, cinematic arrival. Start with the place, then discover the possibilities. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#111e24",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/harbor-cinema-landscape.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-harbor-cinema-portrait",
    "name": "Corporate · Commercial Real Estate · Harbor Cinema — Portrait — Portrait",
    "description": "An immersive, cinematic arrival. Start with the place, then discover the possibilities. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#111e24",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/harbor-cinema-portrait.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-vertical-atlas-landscape",
    "name": "Corporate · Commercial Real Estate · Vertical Atlas",
    "description": "A tactile building atlas. Explore floors and compare spaces from the architecture outward. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#edf1f0",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/vertical-atlas-landscape.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-vertical-atlas-portrait",
    "name": "Corporate · Commercial Real Estate · Vertical Atlas — Portrait — Portrait",
    "description": "A tactile building atlas. Explore floors and compare spaces from the architecture outward. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#edf1f0",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/vertical-atlas-portrait.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-district-fieldnotes-landscape",
    "name": "Corporate · Commercial Real Estate · District Fieldnotes",
    "description": "A hand-drawn neighborhood canvas connecting a workplace to the life around it. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#f0eadc",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/district-fieldnotes-landscape.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-district-fieldnotes-portrait",
    "name": "Corporate · Commercial Real Estate · District Fieldnotes — Portrait — Portrait",
    "description": "A hand-drawn neighborhood canvas connecting a workplace to the life around it. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#f0eadc",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/district-fieldnotes-portrait.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-the-arrival-club-landscape",
    "name": "Corporate · Commercial Real Estate · The Arrival Club",
    "description": "A warm, editorial member-club journey led by amenities, rituals and the working day. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#ece4d8",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/the-arrival-club-landscape.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-the-arrival-club-portrait",
    "name": "Corporate · Commercial Real Estate · The Arrival Club — Portrait — Portrait",
    "description": "A warm, editorial member-club journey led by amenities, rituals and the working day. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#ece4d8",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/the-arrival-club-portrait.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-occupier-lab-landscape",
    "name": "Corporate · Commercial Real Estate · Occupier Lab",
    "description": "A clear workspace planning journey: set requirements, compare options and make a shortlist. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#e9edf8",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/occupier-lab-landscape.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-occupier-lab-portrait",
    "name": "Corporate · Commercial Real Estate · Occupier Lab — Portrait — Portrait",
    "description": "A clear workspace planning journey: set requirements, compare options and make a shortlist. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#e9edf8",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/occupier-lab-portrait.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-future-studio-landscape",
    "name": "Corporate · Commercial Real Estate · Future Studio",
    "description": "A creative studio for the next workplace. Compare concepts, upload a reference and build a brief. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "LANDSCAPE",
    "screenWidth": 3840,
    "screenHeight": 2160,
    "bgColor": "#251f2b",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/future-studio-landscape.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "preset-corporate-touch-future-studio-portrait",
    "name": "Corporate · Commercial Real Estate · Future Studio — Portrait — Portrait",
    "description": "A creative studio for the next workplace. Compare concepts, upload a reference and build a brief. Editable spaces, amenities, neighborhood, theme and branded concepts. Fictional starter property; AI examples are labeled.",
    "category": "LOBBY",
    "schoolLevel": "UNIVERSAL",
    "orientation": "PORTRAIT",
    "screenWidth": 2160,
    "screenHeight": 3840,
    "bgColor": "#251f2b",
    "isTouchEnabled": true,
    "idleResetMs": 180000,
    "zones": [
      {
        "name": "Property experience",
        "widgetType": "EXTERNAL_HTML",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "url": "/templates/signage/corporate/commercial-touch/future-studio-portrait.html",
          "touchDocument": {
            "format": "arc-riot.touch-property",
            "version": 1,
            "property": {
              "name": "Harborline Exchange",
              "shortName": "H / E",
              "location": "Fictional waterfront district",
              "headline": "Room for what comes next.",
              "description": "An imagined workplace on the water. Light-filled floors, welcoming shared spaces and a neighborhood worth stepping into. Explore a fictional leasing story, then make it your own.",
              "address": "100 Harborline Way · fictional address",
              "contactLabel": "Leasing conversation",
              "contactEmail": "",
              "sourceLabel": "FICTIONAL PROPERTY · SAMPLE AVAILABILITY",
              "updated": "2026-10-22"
            },
            "settings": {
              "idleSeconds": 180,
              "showSampleLabels": true,
              "accent": "",
              "aiEndpoint": ""
            },
            "assets": {
              "reference": {
                "src": "assets/reference-workplace.png",
                "kind": "ai-concept",
                "label": "AI-generated fictional reference interior",
                "original": true
              },
              "orbit": {
                "src": "assets/orbit-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Orbit Labs · fictional company"
              },
              "fieldwork": {
                "src": "assets/fieldwork-concept.png",
                "kind": "ai-concept",
                "label": "AI concept · Fieldwork · fictional company"
              }
            },
            "spaces": [
              {
                "id": "space-401",
                "name": "The Garden Floor",
                "suite": "401",
                "floor": "4",
                "area": 6800,
                "seats": 44,
                "status": "Sample availability",
                "type": "Creative studio",
                "description": "A flexible concept suite with a planted arrival, collaboration lounge and quieter focus rooms.",
                "features": "Garden outlook, collaboration hub, focus rooms",
                "image": "fieldwork"
              },
              {
                "id": "space-702",
                "name": "The Waterfront Studio",
                "suite": "702",
                "floor": "7",
                "area": 12400,
                "seats": 82,
                "status": "Sample availability",
                "type": "Team headquarters",
                "description": "An imagined full-floor workplace with long waterfront views, shared project rooms and room for a growing team.",
                "features": "Waterfront views, project rooms, visitor lounge",
                "image": "reference"
              },
              {
                "id": "space-1201",
                "name": "The Horizon Collection",
                "suite": "1201",
                "floor": "12",
                "area": 18600,
                "seats": 126,
                "status": "Sample availability",
                "type": "Flagship workplace",
                "description": "A signature workplace concept for a larger team, with client-facing spaces and a generous central gathering area.",
                "features": "Panoramic outlook, client suite, large gathering space",
                "image": "orbit"
              }
            ],
            "amenities": [
              {
                "id": "amenity-01",
                "name": "The Living Room",
                "category": "Connect",
                "description": "A hospitality-inspired shared lounge for informal meetings and everyday arrival. Fictional amenity.",
                "image": "reference"
              },
              {
                "id": "amenity-02",
                "name": "Garden Terrace",
                "category": "Recharge",
                "description": "An imagined planted terrace with sheltered seats and space to pause between meetings.",
                "image": "fieldwork"
              },
              {
                "id": "amenity-03",
                "name": "Project House",
                "category": "Create",
                "description": "Flexible workshop and presentation settings for the moments when the whole team comes together.",
                "image": "orbit"
              },
              {
                "id": "amenity-04",
                "name": "The Daily Ritual",
                "category": "Gather",
                "description": "A proposed café and social setting at the heart of the fictional property.",
                "image": "reference"
              }
            ],
            "places": [
              {
                "id": "place-01",
                "name": "Harbor Promenade",
                "category": "Outdoors",
                "minutes": 3,
                "x": 22,
                "y": 29,
                "description": "An illustrative waterfront walk. Route and walking time are sample content, not navigation."
              },
              {
                "id": "place-02",
                "name": "Market Hall",
                "category": "Food",
                "minutes": 5,
                "x": 68,
                "y": 31,
                "description": "A fictional neighborhood food hall with imagined independent kitchens."
              },
              {
                "id": "place-03",
                "name": "Exchange Station",
                "category": "Transit",
                "minutes": 7,
                "x": 73,
                "y": 69,
                "description": "A fictional transit connection. Verify actual routes before publishing any property."
              },
              {
                "id": "place-04",
                "name": "Foundry Gardens",
                "category": "Outdoors",
                "minutes": 4,
                "x": 30,
                "y": 73,
                "description": "A fictional pocket park and landscaped place to recharge."
              }
            ]
          }
        }
      }
    ]
  }
];
