async function loadRoverPhoto() {
  const params = new URLSearchParams(window.location.search);
  const rover = params.get('rover') || 'Curiosity';
  const earthDate = params.get('earth_date') || '2021-07-12';

  const stage = document.getElementById('stage');
  const backdrop = document.getElementById('backdrop');
  const image = document.getElementById('feature-image');
  const caption = document.getElementById('caption');

  try {
    const res = await fetch(`/api/rover-photo?rover=${encodeURIComponent(rover)}&earth_date=${encodeURIComponent(earthDate)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || res.statusText);
    }

    backdrop.style.backgroundImage = `url(${data.img_src})`;
    image.src = data.img_src;
    image.alt = `${data.rover} rover photo, ${data.camera}, ${data.earth_date}`;
    caption.textContent = `${data.rover} · ${data.camera} · ${data.earth_date} · ${data.width}×${data.height}`;
    stage.classList.remove('loading');
  } catch (err) {
    stage.classList.remove('loading');
    stage.classList.add('error');
    caption.textContent = `Couldn't load a rover photo: ${err.message}`;
  }
}

loadRoverPhoto();
