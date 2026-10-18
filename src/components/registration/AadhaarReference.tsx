/**
 * A skeletal (placeholder) drawing of an Aadhaar card's FRONT side, shown next
 * to the upload control so athletes know exactly which side to photograph and
 * which details must be legible — above all the date of birth.
 *
 * It is a wireframe only: no real numbers, no real photograph.
 */
export function AadhaarReference({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 302"
      role="img"
      aria-label="Sample Aadhaar card, front side, for reference"
      className={className}
    >
      {/* card */}
      <rect x="1.5" y="1.5" width="477" height="299" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />

      {/* header */}
      <circle cx="34" cy="30" r="11" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="29" y="25" width="10" height="10" rx="2" fill="#e2e8f0" />
      <text x="54" y="27" fontSize="11" fontWeight="600" fill="#64748b">
        Government of India
      </text>
      <text x="54" y="40" fontSize="10" fill="#94a3b8">
        Unique Identification Authority
      </text>
      <text x="456" y="34" fontSize="13" fontWeight="700" letterSpacing="2" textAnchor="end" fill="#cbd5e1">
        AADHAAR
      </text>

      {/* photograph */}
      <rect
        x="26"
        y="70"
        width="86"
        height="104"
        rx="6"
        fill="#f8fafc"
        stroke="#cbd5e1"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <text x="69" y="127" fontSize="11" textAnchor="middle" fill="#94a3b8">
        Photo
      </text>

      {/* details */}
      <text x="132" y="86" fontSize="9" fill="#94a3b8">
        Name
      </text>
      <rect x="132" y="91" width="200" height="9" rx="3" fill="#e2e8f0" />

      <text x="132" y="120" fontSize="9" fill="#94a3b8">
        Date of Birth
      </text>
      <rect x="132" y="125" width="130" height="9" rx="3" fill="#e2e8f0" />

      <text x="132" y="154" fontSize="9" fill="#94a3b8">
        Gender
      </text>
      <rect x="132" y="159" width="90" height="9" rx="3" fill="#e2e8f0" />

      {/* Aadhaar number + QR */}
      <line x1="26" y1="196" x2="454" y2="196" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="30" y="216" fontSize="9" fill="#94a3b8">
        Aadhaar Number
      </text>
      <text x="28" y="249" fontSize="24" fontWeight="600" letterSpacing="4" fill="#cbd5e1">
        XXXX XXXX XXXX
      </text>

      <rect x="374" y="212" width="80" height="80" rx="6" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
      <rect x="384" y="222" width="18" height="18" fill="#cbd5e1" />
      <rect x="428" y="222" width="18" height="18" fill="#cbd5e1" />
      <rect x="384" y="250" width="16" height="16" fill="#cbd5e1" />
      <rect x="410" y="246" width="10" height="10" fill="#e2e8f0" />
      <rect x="428" y="256" width="18" height="18" fill="#cbd5e1" />
      <rect x="406" y="270" width="12" height="12" fill="#e2e8f0" />
    </svg>
  )
}
