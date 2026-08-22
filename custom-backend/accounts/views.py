from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate
from django.http import FileResponse
from .models import Profile, File
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.throttling import AnonRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    scope = 'login'   # uses the '5/min' rate from settings, keyed by IP


def serialize_file(f):
    return {
        'id': f.id,
        'ownerId': f.owner_id,
        'fileName': f.file_name,
        'mimeType': f.mime_type,
        'sizeBytes': f.size_bytes,
        'uploadedAt': f.uploaded_at,
    }


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    email = request.data.get('email')
    password = request.data.get('password')
    if not email or not password:
        return Response({'error': 'email and password are required'}, status=400)
    if User.objects.filter(username=email).exists():
        return Response({'error': 'An account with that email already exists'}, status=409)
    user = User.objects.create_user(username=email, email=email, password=password)
    Profile.objects.create(user=user, display_name=email.split('@')[0])
    return Response({'id': user.id, 'email': user.email}, status=201)


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle]) 
def login(request):
    email = request.data.get('email')
    password = request.data.get('password')

    if not email or not password:
        return Response({'error': 'email and password are required'}, status=400)

    user = authenticate(username=email, password=password)

    if user is None:
        return Response({'error': 'Invalid email or password'}, status=401)

    token, _ = Token.objects.get_or_create(user=user)

    return Response({'token': token.key, 'user': {'id': user.id, 'email': user.email}})

@api_view(['GET'])
def me(request):
    user = request.user
    return Response({
        'id': user.id, 
        'email': user.email, 
        'profile': {
            'fullName': user.profile.full_name,
            'displayName': user.profile.display_name,
            'bio': user.profile.bio,
            'role': user.profile.role,
            'createdAt': user.profile.created_at,
        },
    })


@api_view(['GET'])
def files(request):
    user_files = File.objects.filter(owner=request.user)
    return Response({'files': [serialize_file(f) for f in user_files]})    


@api_view(['GET'])
def file_detail(request, file_id):
    file = File.objects.filter(id=file_id).first()

    if file is None:
        return Response({'error': 'File not found'}, status = 404)

    if file.owner_id != request.user.id:
        return Response({'error': 'You do not have access to this file'}, status=403)

    return Response({'file': serialize_file(file)})


@api_view(['POST'])
def logout(request):
    request.user.auth_token.delete()
    return Response({'message': 'User has been logged out'})

@api_view(['GET'])
def file_download(request, file_id):
    file = File.objects.filter(id=file_id).first()

    if file is None:
        return Response({'error': 'File not found'}, status=404)

    if file.owner_id != request.user.id:
        return Response({'error': 'You do not have access to this file'}, status=403)

    return FileResponse(file.content.open('rb'), as_attachment=True, filename=file.file_name)



