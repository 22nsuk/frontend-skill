(() => {
  const form = document.getElementById('booking-form');
  const status = document.getElementById('booking-status');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const payload = {
      name: form.elements.name.value,
      phone: form.elements.phone.value,
      date: form.elements.date.value,
    };

    status.textContent = '예약 신청이 접수되었습니다.';

    fetch('api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        form.reset();
      })
      .catch(() => {
        form.reset();
        status.textContent = '문제가 발생했습니다.';
      });
  });
})();
