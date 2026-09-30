# Computer Brain

Sitio estático servido por un backend Node.js mínimo. El servidor consulta las reseñas del Perfil de Negocio de Google; las credenciales OAuth nunca se envían al navegador.

## Requisitos

- Node.js 22 o superior.
- Acceso de administrador a la ficha verificada de Computer Brain.
- Acceso aprobado a las APIs de Google Business Profile para un proyecto de Google Cloud.

## Habilitar Google

1. En Google Cloud, habilita **My Business Account Management API**, **My Business Business Information API** y **My Business API**. El acceso a las APIs de Perfil de Negocio puede requerir una solicitud y aprobación de Google para el proyecto.
2. Configura la pantalla de consentimiento OAuth y crea un ID de cliente OAuth. Si usas OAuth 2.0 Playground para obtener el token, agrega `https://developers.google.com/oauthplayground` como URI de redirección autorizada del cliente.
3. En [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), activa **Use your own OAuth credentials** e introduce el ID y el secreto del cliente. Autoriza el alcance `https://www.googleapis.com/auth/business.manage` y canjea el código por tokens.
4. Copia el ID de cliente, el secreto y el token de actualización a un archivo `.env` local. No los publiques ni los envíes por chat.

En PowerShell, crea el archivo de configuración así:

```powershell
Copy-Item .env.example .env
```

Completa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REFRESH_TOKEN` en `.env`. El servidor busca automáticamente una ubicación cuyo nombre coincida con `GBP_LOCATION_TITLE`; puedes modificar ese valor si el nombre de la ficha es distinto.

## Ejecutar

```powershell
npm start
```

Abre `http://127.0.0.1:3000`. No se requieren paquetes externos. Si OAuth o el acceso de Google aún no están configurados, el sitio conserva el enlace a las reseñas de Maps y muestra un aviso en lugar de reseñas simuladas.

## Actualización

La API se consulta con las reseñas ordenadas por última actualización. El backend conserva la respuesta durante cuatro minutos y el navegador vuelve a consultarla cada cinco minutos; una reseña aparecerá cuando Google la publique en la API y se complete la siguiente actualización. La sección presenta las tres más recientes y enlaza a la ficha para ver todas.

## Publicar

El sitio debe ejecutarse como aplicación Node.js para que `/api/reviews` funcione; abrir `index.html` directamente o publicarlo en un hosting solo estático no conecta la API. En producción, configura `HOST=0.0.0.0`, usa el puerto que asigne el proveedor y carga `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REFRESH_TOKEN` como variables secretas del servicio. No publiques el archivo `.env`.

## GitHub Pages y backend

El workflow `.github/workflows/deploy-pages.yml` publica `index.html` y `KomikaAxis.ttf` al hacer push a `main`. En **Settings > Pages**, selecciona **GitHub Actions** como origen.

Para que las reseñas sigan funcionando desde Pages, aloja también el servidor Node en un servicio público. Configura en ese servicio `FRONTEND_ORIGIN` con el origen de Pages (por ejemplo, `https://tu-usuario.github.io`) y `HOST=0.0.0.0`. En **Settings > Secrets and variables > Actions > Variables**, crea `REVIEWS_API_BASE` con la URL raíz del servidor Node, sin `/api/reviews`. Las credenciales OAuth van únicamente en el servicio Node, no en GitHub Pages.

Después de cambiar `REVIEWS_API_BASE`, vuelve a ejecutar **Deploy GitHub Pages** desde la pestaña **Actions** para reconstruir el sitio con esa URL.

## SEO y buscadores

El sitio incluye título y descripción específicos, URL canónica, datos estructurados `LocalBusiness`, `robots.txt` y `sitemap.xml`. Para solicitar indexación, verifica `https://abraxxas-lab.github.io/computer-brain-servicio-tecnico/` en Google Search Console y envía `https://abraxxas-lab.github.io/computer-brain-servicio-tecnico/sitemap.xml`. La indexación y la posición dependen de Google; estos ajustes ayudan a descubrir y entender la página, pero no garantizan aparecer en primer lugar.