// Display bands for the existing /50 quality average; selection scoring is separate.
export function cadreQualityCategory(data) {
  const assessed=Number(data.assessed_count),total=data.performance_score;
  const known=typeof total==='number'&&Number.isFinite(total)&&total>=0&&total<=50&&Number.isSafeInteger(assessed)&&assessed>0;
  const category=!known?{key:'unassessed',label:'Belum dinilai',message:'Penilaian akan tampil setelah petugas menilai laporan Anda secara lengkap.'}
    :total<30?{key:'attention',label:'Perlu perhatian',message:'Terima kasih atas laporan Anda. Lihat catatan petugas untuk mengetahui informasi yang bisa dilengkapi.'}
    :total<40?{key:'good',label:'Baik',message:'Terima kasih, informasi dalam laporan Anda membantu petugas meninjau kejadian.'}
    :{key:'excellent',label:'Sangat baik',message:'Terima kasih atas ketelitian Anda dalam menyampaikan informasi kepada petugas.'};
  return {known,...category};
}

export function renderCadreQuality(data) {
  const assessed=Number(data.assessed_count),reports=Number(data.report_count),total=data.performance_score;
  const category=cadreQualityCategory(data),known=category.known;
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('id-ID'):'Belum dinilai';
  const count=Number.isSafeInteger(reports)&&reports>=0?reports:0;
  const components=data.components||{};
  const points=(label,value,max)=>`<div><dt>${label}</dt><dd>${number(value)}${value==null?'':` <span>/ ${max}</span>`}</dd></div>`;
  const details=known?`<details id="cadreQualityDetails" class="cadre-quality-details"><summary>Lihat rincian penilaian</summary>
    <dl class="cadre-quality-components">${points('Rata-rata skor',total,50)}${points('Kualitas informasi',components.information,20)}${points('Kelengkapan',components.completeness,15)}${points('Ketepatan waktu',components.timeliness,15)}</dl>
    <p class="help">Rata-rata dari ${assessed} laporan yang dinilai lengkap dalam 6 bulan terakhir. Komponen dihitung dari laporan yang sama; laporan yang belum dinilai lengkap belum masuk rata-rata.</p>
    <p class="help">Kategori tampilan: Perlu perhatian &lt; 30; Baik 30–&lt; 40; Sangat baik 40–50. Pembulatan komponen dapat membuat jumlahnya sedikit berbeda dari rata-rata skor.</p>
    <a href="#cadre-home?view=history">Lihat penilaian tiap laporan</a></details>`:'';
  return `<div class="cadre-quality-summary" data-quality-category="${category.key}"><p class="cadre-quality-category">${category.label}</p><p class="cadre-quality-message">${category.message}</p>
    <p class="help cadre-quality-context">${known?`${assessed} dari ${count} laporan dinilai lengkap · 6 bulan terakhir`:'Laporan yang belum dinilai lengkap tidak dihitung sebagai nol.'}</p></div>${details}`;
}
