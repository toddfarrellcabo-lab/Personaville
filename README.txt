Personaville v1.0

Folder layout:
- index.html
- database/persona-db.xlsx
- database/persona-db.json
- components/header.html
- css/app.css
- css/header.css
- js/app.js
- js/database.js
- js/header.js
- js/render.js
- assets/icons/
- assets/images/
  - personaville-header.png
- audio/
  - 8bit-Personaville-loop.mp3
- exports/
- backups/

How to use:
1. Open index.html in Chrome or Edge.
2. Personaville opens to the Persona Library by default; Dashboard remains available in the sidebar.
3. The bundled JSON may load automatically.
4. If it does not, click Upload Workbook and select database/persona-db.xlsx.
5. Edit the workbook, save it, then use Upload Workbook again.
6. Use Export Center to print a selected persona.

Notes:
- Workbook upload uses SheetJS from CDN. If internet is unavailable, bundled JSON still lets the app display the current database in most browser/server setups.
- Icons are expected in the assets/icons/ folder. Missing icons are handled gracefully.
- The reusable hero header is loaded from components/header.html once, without an iframe.
- The optional header audio is controlled by the Play/Stop button and persists across Dashboard, Personas, Modifiers, Database Health, Publish, Export, and Settings navigation.

Next steps:
- See ROADMAP.md for the Personaville project roadmap.
- NEXT_STEPS.md points to the active roadmap location.
