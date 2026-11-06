# Epic Splash

Sitio comunitario de Pokémon TCG para publicar torneos, consultar el manual, construir barajas e imprimir proxies. El código se sirve directamente desde `public/`.

## Vista local

Ejecuta `python3 -m http.server 8000 --directory public` y abre [localhost:8000](http://localhost:8000). El deckbuilder necesita Internet para cargar TCGdex. Las pruebas de composición se ejecutan con `node --test` (Node.js 22).

## Configurar Firebase y GitHub

1. Crea o selecciona un proyecto Firebase, registra una aplicación web, activa Firestore en modo producción y habilita Google en Authentication. Copia el objeto de configuración pública de la app a `public/firebase-config.mjs`.
2. Autoriza `epicsplash.cl` en Authentication → Settings → Authorized domains. Autoriza `localhost` si probarás el inicio de sesión localmente.
3. Sube el proyecto a un repositorio de GitHub con rama `main`. En Settings → Secrets and variables → Actions, configura la variable `FIREBASE_PROJECT_ID` y el secreto `FIREBASE_SERVICE_ACCOUNT` con el JSON de una cuenta de servicio autorizada para desplegar Hosting y reglas de Firestore. El flujo ejecuta las pruebas y despliega al actualizar `main` o al iniciarlo manualmente.
4. En Firebase Hosting, añade `epicsplash.cl` como dominio personalizado. Aplica en el proveedor del dominio los registros DNS que Firebase muestre y espera que Hosting confirme el dominio y su certificado.
5. Entra con Google en la sección Administración y copia tu UID. En la consola de Firestore crea la colección `roles` y un documento cuyo ID sea ese UID, con el campo de texto `role` igual a `superadmin`. Desde el sitio puedes conceder y revocar acceso de editor a otros UID.

Los visitantes ven las barajas y próximos torneos publicados. Cada editor gestiona sus propias publicaciones. Las reglas de Firestore validan identidad, propiedad y estructura, y el deckbuilder valida la composición al publicar desde la interfaz.

Los torneos usan el huso de Santiago de Chile. Si el cambio de hora duplica una hora local, se usa la primera ocurrencia. La impresión usa A4 con 9 proxies por página, a 63 × 88 mm. Selecciona escala 100 % y desactiva encabezados y pies de página.

## Catálogo

La lista base en `public/legality.json` sigue el [manual oficial en inglés](https://docs.google.com/document/d/1_YZU3WVeESPZ1tR4r9uVvFLpKcaJWBiU3GxJvIC-gtU/edit), cuya actualización del 3 de agosto de 2026 incorpora el límite compartido de Yell Horn y Dark Bell. Las cartas sin asteriscos siguen el máximo estándar de cuatro. Las imágenes y nombres se consultan en [TCGdex](https://tcgdex.dev/). Para algunas impresiones, el Deckbuilder usa como respaldo una imagen en español de [Limitless TCG](https://limitlesstcg.com/cards), verificada para la misma expansión y número. Si la imagen disponible está en inglés, se indica en la ficha y antes de imprimir. Si faltan imágenes en ambos idiomas, la impresión se detiene e indica las cartas afectadas.
