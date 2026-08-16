import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.base import ContentFile

from accounts.models import Profile, File


class Command(BaseCommand):
    help = "Seed the database with test users, profiles, and files from web-client/seed-data.json"

    def handle(self, *args, **options):
        # The provided seed file lives in the repo's web-client/ folder (one level up from custom-backend).
        seed_path = Path(settings.BASE_DIR).parent / 'web-client' / 'seed-data.json'
        with open(seed_path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)

        for u in data['users']:
            email = u['email']

            # Idempotent: wipe any existing user with this email first, so re-running gives a clean result.
            # Deleting the user cascades to their Profile and Files (that's the on_delete=CASCADE we set).
            User.objects.filter(username=email).delete()

            # create_user hashes the plaintext password from the JSON before storing it.
            user = User.objects.create_user(
                username=email,
                email=email,
                password=u['password'],
            )

            p = u['profile']
            Profile.objects.create(
                user=user,
                full_name=p.get('fullName', ''),
                display_name=p.get('displayName', ''),
                bio=p.get('bio', ''),
                role=p.get('role', 'user'),
            )

            for f in u['files']:
                # Generate small placeholder bytes so downloads return something real.
                placeholder = ContentFile(
                    f"Placeholder contents for {f['fileName']}.\n".encode('utf-8'),
                    name=f['fileName'],
                )
                File.objects.create(
                    owner=user,
                    file_name=f['fileName'],
                    mime_type=f['mimeType'],
                    size_bytes=f['sizeBytes'],
                    content=placeholder,
                )

            self.stdout.write(self.style.SUCCESS(f"Seeded {email} with {len(u['files'])} files"))

        self.stdout.write(self.style.SUCCESS("Done seeding."))